/**
 * OAuth Service
 * Handles OAuth connections with Square and Clover POS systems
 * Based on SalesArc OAuth Flow Architecture
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import { SquareClient, SquareEnvironment } from 'square';
import { createCloverClient, CloverEnvironment } from 'clover-nodejs-sdk';
import { db, OAuthState, POSConnection } from '../models';

export interface OAuthConnectRequest {
  provider: 'square' | 'clover';
  merchantId: string;
}

export interface OAuthConnectResponse {
  authorizationUrl: string;
  state: string;
}

export interface OAuthCallbackRequest {
  provider: 'square' | 'clover';
  code: string;
  state: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  merchantAccountId: string;
  expiresAt: Date;
  webhookSecret?: string;
}

export class OAuthService {
  private readonly ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  /**
   * Initiate OAuth connection flow
   * Step 1: Generate encrypted state and return authorization URL
   */
  async initiateConnection(request: OAuthConnectRequest): Promise<OAuthConnectResponse> {
    const { provider, merchantId } = request;

    // Generate encrypted state containing merchantId + nonce
    const nonce = randomUUID();
    const stateData = JSON.stringify({ merchantId, nonce, provider });
    const encryptedState = this.encrypt(stateData);

    // Store state temporarily (expires in 10 minutes)
    const oauthState: OAuthState = {
      id: randomUUID(),
      state: encryptedState,
      merchantId,
      provider,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      createdAt: new Date()
    };

    db.oauthStates.set(oauthState.id, oauthState);
    db.oauthStateByState.set(encryptedState, oauthState);

    // Generate authorization URL based on provider
    const authorizationUrl = this.generateAuthorizationUrl(provider, encryptedState);

    return {
      authorizationUrl,
      state: encryptedState
    };
  }

  /**
   * Handle OAuth callback
   * Step 7: Exchange code for tokens and store connection
   */
  async handleCallback(request: OAuthCallbackRequest): Promise<POSConnection> {
    const { provider, code, state } = request;

    // Step 8: Validate state
    const oauthState = db.oauthStateByState.get(state);
    if (!oauthState || oauthState.expiresAt < new Date()) {
      throw new Error('Invalid or expired OAuth state');
    }

    // Step 10: Decrypt state to get merchantId
    const stateData = JSON.parse(this.decrypt(state));
    const { merchantId } = stateData;

    // Step 11-12: Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(provider, code);

    // Step 13: Encrypt tokens at rest
    const encryptedAccessToken = this.encrypt(tokens.accessToken);
    const encryptedRefreshToken = this.encrypt(tokens.refreshToken);
    const encryptedWebhookSecret = tokens.webhookSecret ? this.encrypt(tokens.webhookSecret) : undefined;

    // Step 14: Store POS connection
    const connection: POSConnection = {
      id: randomUUID(),
      merchantId,
      provider,
      merchantAccountId: tokens.merchantAccountId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: tokens.expiresAt,
      webhookSecret: encryptedWebhookSecret,
      status: 'connected',
      lastConnectedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    db.posConnections.set(connection.id, connection);

    // Update merchant index
    if (!db.posConnectionByMerchant.has(merchantId)) {
      db.posConnectionByMerchant.set(merchantId, []);
    }
    db.posConnectionByMerchant.get(merchantId)!.push(connection);

    // Clean up used state
    db.oauthStates.delete(oauthState.id);
    db.oauthStateByState.delete(state);

    return connection;
  }

  /**
   * Get POS connection for a merchant
   */
  getConnection(merchantId: string, provider: 'square' | 'clover'): POSConnection | null {
    const connections = db.posConnectionByMerchant.get(merchantId) || [];
    return connections.find(c => c.provider === provider && c.status === 'connected') || null;
  }

  /**
   * Decrypt and get access token for API calls
   */
  getDecryptedAccessToken(connection: POSConnection): string {
    return this.decrypt(connection.accessToken);
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    provider: 'square' | 'clover',
    signature: string,
    body: string,
    merchantId: string
  ): boolean {
    const connection = this.getConnection(merchantId, provider);
    if (!connection?.webhookSecret) {
      return false;
    }

    const webhookSecret = this.decrypt(connection.webhookSecret);

    if (provider === 'square') {
      // Square: HMAC-SHA256 with base64 encoding
      const expectedSignature = createHmac('sha256', webhookSecret)
        .update(body)
        .digest('base64');
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } else if (provider === 'clover') {
      // Clover: HMAC-SHA256 with hex encoding
      const timestamp = new Date().toISOString(); // In production, get from header
      const payload = `${timestamp}.${body}`;
      const expectedSignature = createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    }

    return false;
  }

  /**
   * Refresh access token
   */
  async refreshToken(connection: POSConnection): Promise<void> {
    try {
      const refreshToken = this.decrypt(connection.refreshToken);
      const newTokens = await this.refreshAccessToken(connection.provider, refreshToken);

      // Update connection with new tokens
      connection.accessToken = this.encrypt(newTokens.accessToken);
      connection.refreshToken = this.encrypt(newTokens.refreshToken);
      connection.tokenExpiresAt = newTokens.expiresAt;
      connection.lastConnectedAt = new Date();
      connection.updatedAt = new Date();

      db.posConnections.set(connection.id, connection);
    } catch (error) {
      console.error('Token refresh failed:', error);
      connection.status = 'failed';
      connection.lastError = error instanceof Error ? error.message : 'Unknown error';
      connection.updatedAt = new Date();
      db.posConnections.set(connection.id, connection);
    }
  }

  // Private methods

  private generateAuthorizationUrl(provider: 'square' | 'clover', state: string): string {
    if (provider === 'square') {
      const baseUrl = process.env.NODE_ENV === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com';

      const clientId = process.env.SQUARE_APPLICATION_ID!;
      const scopes = 'MERCHANT_PROFILE_READ,PAYMENTS_READ,ORDERS_READ,CUSTOMERS_READ,WEBHOOKS_WRITE';

      return `${baseUrl}/oauth2/authorize?client_id=${clientId}&scope=${scopes}&state=${state}`;
    } else if (provider === 'clover') {
      const baseUrl = process.env.NODE_ENV === 'production'
        ? 'https://www.clover.com'
        : 'https://sandbox.dev.clover.com';

      const clientId = process.env.CLOVER_APPLICATION_ID!;
      const redirectUri = encodeURIComponent(`${process.env.BASE_URL}/api/oauth/clover/callback`);

      return `${baseUrl}/oauth/v2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}`;
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  private async exchangeCodeForTokens(provider: 'square' | 'clover', code: string): Promise<OAuthTokens> {
    if (provider === 'square') {
      // For demo purposes, simulate token exchange
      // In production, use Square SDK's obtainToken method
      console.log('Exchanging Square code for tokens:', code);

      return {
        accessToken: `sq_access_${randomUUID()}`,
        refreshToken: `sq_refresh_${randomUUID()}`,
        merchantAccountId: `sq_merchant_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
        webhookSecret: process.env.SQUARE_ACCESS_TOKEN, // Use access token as webhook secret for demo
      };
    } else if (provider === 'clover') {
      // Clover token exchange - simplified for demo
      // In production, make HTTP request to Clover's token endpoint
      const clover = createCloverClient({
        environment: process.env.NODE_ENV === 'production' ? CloverEnvironment.PROD_NA : CloverEnvironment.DEV,
        authKey: process.env.CLOVER_APP_SECRET!,
      });

      // Mock token response for demo
      return {
        accessToken: `clover_token_${randomUUID()}`,
        refreshToken: `clover_refresh_${randomUUID()}`,
        merchantAccountId: `clover_merchant_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
        webhookSecret: process.env.CLOVER_APP_SECRET,
      };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  private async refreshAccessToken(provider: 'square' | 'clover', refreshToken: string): Promise<OAuthTokens> {
    if (provider === 'square') {
      // For demo purposes, simulate token refresh
      console.log('Refreshing Square token:', refreshToken);

      return {
        accessToken: `sq_access_${randomUUID()}`,
        refreshToken: `sq_refresh_${randomUUID()}`,
        merchantAccountId: `sq_merchant_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600000),
        webhookSecret: process.env.SQUARE_ACCESS_TOKEN,
      };
    } else if (provider === 'clover') {
      // Mock refresh for demo
      return {
        accessToken: `clover_token_${randomUUID()}`,
        refreshToken: `clover_refresh_${randomUUID()}`,
        merchantAccountId: `clover_merchant_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600000),
        webhookSecret: process.env.CLOVER_APP_SECRET,
      };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY.slice(0, 32), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY.slice(0, 32), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

export const oauthService = new OAuthService();