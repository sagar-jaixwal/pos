/**
 * API Routes for POS Rewards System
 */

import { Router, Request, Response } from 'express';
import { posAdapter, POSTransactionRequest } from '../services/pos-adapter';
import { walletService } from '../services/wallet';
import { squareService, SquareWebhookEvent } from '../services/square';
import { cloverService, CloverWebhookEvent } from '../services/clover';
import { oauthService } from '../services/oauth';
import { db } from '../models';

const router = Router();

/**
 * POST /api/transaction
 * Process a new transaction from POS system
 * Called by Square/Clover webhook or direct integration
 */
router.post('/transaction', async (req: Request, res: Response) => {
  try {
    const transactionData: POSTransactionRequest = req.body;

    // Validate required fields
    if (!transactionData.posSystemId || !transactionData.merchantId) {
      return res.status(400).json({
        success: false,
        error: 'posSystemId and merchantId are required'
      });
    }

    if (!transactionData.totalAmount || transactionData.totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid totalAmount is required'
      });
    }

    if (!transactionData.items || transactionData.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one item is required'
      });
    }

    const result = await posAdapter.processTransaction(transactionData);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error processing transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process transaction'
    });
  }
});

/**
 * GET /api/customer/:phoneNumber
 * Get customer wallet information by phone number
 * Called when customer enters phone number at checkout
 */
router.get('/customer/:phoneNumber', (req: Request, res: Response) => {
  try {
    let phoneNumber = req.params.phoneNumber;
    let merchantId = Array.isArray(req.query.merchantId) 
      ? req.query.merchantId[0] 
      : req.query.merchantId;

    // Handle Express 5.x where params can be array
    if (Array.isArray(phoneNumber)) {
      phoneNumber = phoneNumber[0];
    }

    // Ensure merchantId is a string
    if (typeof merchantId !== 'string') {
      merchantId = String(merchantId);
    }

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'merchantId query parameter is required'
      });
    }

    const walletInfo = posAdapter.getCustomerWallet(phoneNumber, merchantId);

    res.json({
      success: true,
      data: walletInfo
    });
  } catch (error) {
    console.error('Error fetching customer wallet:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer wallet'
    });
  }
});

/**
 * POST /api/customer/:phoneNumber/redeem
 * Redeem points for a voucher
 */
router.post('/customer/:phoneNumber/redeem', (req: Request, res: Response) => {
  try {
    let phoneNumber = req.params.phoneNumber;
    
    // Handle Express 5.x where params can be array
    if (Array.isArray(phoneNumber)) {
      phoneNumber = phoneNumber[0];
    }
    
    const { thresholdIndex, merchantId } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    if (thresholdIndex === undefined || typeof thresholdIndex !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'thresholdIndex is required'
      });
    }

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'merchantId is required'
      });
    }

    const customer = walletService.getCustomerByPhone(phoneNumber);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const voucher = walletService.redeemPointsForVoucher(
      customer.id,
      thresholdIndex,
      merchantId
    );

    res.json({
      success: true,
      data: {
        voucher: {
          code: voucher.code,
          discountType: voucher.discountType,
          discountValue: voucher.discountValue,
          minPurchaseAmount: voucher.minPurchaseAmount,
          maxDiscountAmount: voucher.maxDiscountAmount,
          validFrom: voucher.validFrom,
          validUntil: voucher.validUntil
        },
        message: `Voucher generated: ${voucher.code}`
      }
    });
  } catch (error) {
    console.error('Error redeeming points:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to redeem points'
    });
  }
});

/**
 * GET /api/customer/:phoneNumber/history
 * Get customer's transaction and rewards history
 */
router.get('/customer/:phoneNumber/history', (req: Request, res: Response) => {
  try {
    let phoneNumber = req.params.phoneNumber;

    // Handle Express 5.x where params can be array
    if (Array.isArray(phoneNumber)) {
      phoneNumber = phoneNumber[0];
    }

    const customer = walletService.getCustomerByPhone(phoneNumber);
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    const transactions = walletService.getCustomerTransactions(customer.id);
    const pointsHistory = walletService.getPointsHistory(customer.id);
    const voucherHistory = walletService.getVoucherHistory(customer.id);

    res.json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          phoneNumber: customer.phoneNumber,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email
        },
        transactions: transactions.map(t => ({
          id: t.id,
          totalAmount: t.totalAmount,
          items: t.items.length,
          status: t.status,
          createdAt: t.createdAt
        })),
        pointsHistory,
        voucherHistory
      }
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history'
    });
  }
});

/**
 * GET /api/merchant/:merchantId/rule
 * Get reward rule configuration for a merchant
 */
router.get('/merchant/:merchantId/rule', (req: Request, res: Response) => {
  try {
    let merchantId = req.params.merchantId;

    // Handle Express 5.x where params can be array
    if (Array.isArray(merchantId)) {
      merchantId = merchantId[0];
    }

    const rule = posAdapter.getRewardRule(merchantId);

    if (!rule) {
      return res.status(404).json({
        success: false,
        error: 'Reward rule not found for this merchant'
      });
    }

    res.json({
      success: true,
      data: rule
    });
  } catch (error) {
    console.error('Error fetching reward rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reward rule'
    });
  }
});

/**
 * PUT /api/merchant/:merchantId/rule
 * Update reward rule configuration for a merchant
 */
router.put('/merchant/:merchantId/rule', (req: Request, res: Response) => {
  try {
    let merchantId = req.params.merchantId;

    // Handle Express 5.x where params can be array
    if (Array.isArray(merchantId)) {
      merchantId = merchantId[0];
    }

    const updates = req.body;

    const updatedRule = posAdapter.updateRewardRule(merchantId, updates);

    res.json({
      success: true,
      data: updatedRule,
      message: 'Reward rule updated successfully'
    });
  } catch (error) {
    console.error('Error updating reward rule:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update reward rule'
    });
  }
});

/**
 * POST /api/webhooks/square
 * Handle Square webhook events
 */
router.post('/webhooks/square', async (req: Request, res: Response) => {
  try {
    const event: SquareWebhookEvent = req.body;
    const signature = req.headers['x-square-hmacsha256-signature'] as string;

    // Extract merchant ID from webhook payload
    const merchantId = event.data?.object?.payment?.location_id ||
                      event.merchant_id ||
                      req.headers['x-square-merchant-id'] as string;

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'Merchant ID not found in webhook payload'
      });
    }

    // Verify webhook signature using OAuth service
    if (!oauthService.verifyWebhookSignature('square', signature, JSON.stringify(req.body), merchantId)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }

    // Fast ack - respond immediately
    res.status(200).json({ success: true, message: 'Webhook received' });

    // Process webhook asynchronously
    setImmediate(async () => {
      try {
        const result = await squareService.handleWebhook(event);
        console.log('Square webhook processed:', result);
      } catch (error) {
        console.error('Error processing Square webhook asynchronously:', error);
      }
    });
  } catch (error) {
    console.error('Error processing Square webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process Square webhook'
    });
  }
});

/**
 * POST /api/webhooks/clover
 * Handle Clover webhook events
 */
router.post('/webhooks/clover', async (req: Request, res: Response) => {
  try {
    const event: CloverWebhookEvent = req.body;
    const signature = req.headers['x-clover-signature'] as string;

    // Extract merchant ID from webhook payload
    const merchantId = event.merchantId ||
                      req.headers['x-clover-merchant-id'] as string;

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'Merchant ID not found in webhook payload'
      });
    }

    // Verify webhook signature using OAuth service
    if (!oauthService.verifyWebhookSignature('clover', signature, JSON.stringify(req.body), merchantId)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }

    // Fast ack - respond immediately
    res.status(200).json({ success: true, message: 'Webhook received' });

    // Process webhook asynchronously
    setImmediate(async () => {
      try {
        const result = await cloverService.handleWebhook(event);
        console.log('Clover webhook processed:', result);
      } catch (error) {
        console.error('Error processing Clover webhook asynchronously:', error);
      }
    });
  } catch (error) {
    console.error('Error processing Clover webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process Clover webhook'
    });
  }
});

/**
 * POST /api/oauth/:provider/connect
 * Initiate OAuth connection flow for Square or Clover
 */
router.post('/oauth/:provider/connect', async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as 'square' | 'clover';
    const { merchantId } = req.body;

    if (!['square', 'clover'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Provider must be either "square" or "clover"'
      });
    }

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'merchantId is required'
      });
    }

    const result = await oauthService.initiateConnection({ provider, merchantId });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error initiating OAuth connection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate OAuth connection'
    });
  }
});

/**
 * GET /api/oauth/:provider/callback
 * Handle OAuth callback from Square or Clover
 */
router.get('/oauth/:provider/callback', async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as 'square' | 'clover';
    const { code, state, error, error_description } = req.query;

    if (!['square', 'clover'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Provider must be either "square" or "clover"'
      });
    }

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error, error_description);
      return res.status(400).json({
        success: false,
        error: error_description || error
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code and state are required'
      });
    }

    const connection = await oauthService.handleCallback({
      provider,
      code: code as string,
      state: state as string
    });

    // Redirect to success page or return connection info
    res.json({
      success: true,
      data: {
        connectionId: connection.id,
        provider: connection.provider,
        merchantAccountId: connection.merchantAccountId,
        status: connection.status,
        message: 'OAuth connection established successfully'
      }
    });
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete OAuth connection'
    });
  }
});

/**
 * GET /api/oauth/:provider/status
 * Check OAuth connection status for a merchant
 */
router.get('/oauth/:provider/status', (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as 'square' | 'clover';
    const merchantId = req.query.merchantId as string;

    if (!['square', 'clover'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Provider must be either "square" or "clover"'
      });
    }

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'merchantId query parameter is required'
      });
    }

    const connection = oauthService.getConnection(merchantId, provider);

    if (!connection) {
      return res.json({
        success: true,
        data: {
          connected: false,
          status: 'not_connected'
        }
      });
    }

    res.json({
      success: true,
      data: {
        connected: true,
        connectionId: connection.id,
        provider: connection.provider,
        merchantAccountId: connection.merchantAccountId,
        status: connection.status,
        lastConnectedAt: connection.lastConnectedAt,
        tokenExpiresAt: connection.tokenExpiresAt
      }
    });
  } catch (error) {
    console.error('Error checking OAuth status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check OAuth status'
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

export default router;
