# POS Rewards System

A Node.js + TypeScript based rewards system that integrates with POS systems like Square and Clover to automatically calculate reward points, generate vouchers, and manage customer wallets.

## Architecture

This system is inspired by the [SalesArc architecture](https://dhruvdoshi.github.io/salesarc/) and includes:

- **POS Adapter**: Integrates with external POS systems (Square, Clover, etc.)
- **Reward Engine**: Calculates points and manages voucher generation
- **Wallet Service**: Manages customer wallets, vouchers, and redemptions
- **In-Memory Database**: For demonstration (can be replaced with PostgreSQL/MongoDB)

## Features

- ✅ Automatic point calculation after each purchase
- ✅ Bonus points for specific product categories
- ✅ Voucher generation when points reach thresholds
- ✅ Voucher redemption for discounts on future purchases
- ✅ Customer wallet management via phone number lookup
- ✅ Transaction history tracking
- ✅ Configurable reward rules per merchant

## Project Structure

```
/workspace
├── src/
│   ├── index.ts              # Main entry point
│   ├── routes/
│   │   └── index.ts          # API routes
│   ├── services/
│   │   ├── pos-adapter.ts    # POS integration service
│   │   ├── reward-engine.ts  # Points calculation & vouchers
│   │   └── wallet.ts         # Customer wallet management
│   ├── models/
│   │   └── index.ts          # Data models & in-memory DB
│   ├── middleware/           # Custom middleware (if needed)
│   └── config/               # Configuration files
├── package.json
├── tsconfig.json
├── .env
└── README.md
```

## Installation

```bash
npm install
```

## Running the Server

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

## API Endpoints

### Health Check
```
GET /api/health
```

### Process Transaction
Called by POS system after a purchase.

```
POST /api/transaction
Content-Type: application/json

{
  "posSystemId": "square",
  "merchantId": "merchant_123",
  "customerPhone": "+1234567890",
  "customerFirstName": "John",
  "customerLastName": "Doe",
  "totalAmount": 75.50,
  "items": [
    {
      "productId": "prod_1",
      "name": "T-Shirt",
      "quantity": 2,
      "unitPrice": 25.00,
      "category": "clothing"
    },
    {
      "productId": "prod_2",
      "name": "Jeans",
      "quantity": 1,
      "unitPrice": 25.50,
      "category": "clothing"
    }
  ],
  "voucherCode": "REWARD-ABC123" // Optional
}
```

### Get Customer Wallet
Called when customer enters phone number at checkout.

```
GET /api/customer/:phoneNumber?merchantId=merchant_123
```

### Redeem Points for Voucher
```
POST /api/customer/:phoneNumber/redeem
Content-Type: application/json

{
  "thresholdIndex": 0,
  "merchantId": "merchant_123"
}
```

### Get Customer History
```
GET /api/customer/:phoneNumber/history
```

### Get Merchant Reward Rule
```
GET /api/merchant/:merchantId/rule
```

### Update Merchant Reward Rule
```
PUT /api/merchant/:merchantId/rule
Content-Type: application/json

{
  "pointsPerDollar": 15,
  "bonusCategories": {
    "electronics": 2.0
  }
}
```

## Webhook Integrations

### Square Webhooks
Configure Square to send webhooks to your server for real-time transaction processing.

**Webhook URL:** `POST https://your-domain.com/api/webhooks/square`

**Supported Events:**
- `payment.created` - When a payment is completed
- `payment.updated` - When a payment is updated
- `order.created` - When an order is created
- `order.updated` - When an order is updated

**Setup in Square Dashboard:**
1. Go to your Square Developer Dashboard
2. Navigate to Webhooks
3. Add webhook subscription for your application
4. Set URL to `https://your-domain.com/api/webhooks/square`
5. Select events: `payments` and `orders`

### Clover Webhooks
Configure Clover to send webhooks for transaction events.

**Webhook URL:** `POST https://your-domain.com/api/webhooks/clover`

**Supported Events:**
- `CREATE_ORDER` - When an order is created
- `UPDATE_ORDER` - When an order is updated
- `CREATE_PAYMENT` - When a payment is created
- `UPDATE_PAYMENT` - When a payment is updated

**Setup in Clover Dashboard:**
1. Go to your Clover Developer Dashboard
2. Navigate to Webhooks
3. Add webhook subscription for your application
4. Set URL to `https://your-domain.com/api/webhooks/clover`
5. Select events: `orders` and `payments`

## Example Flow

### 1. First Purchase - Earn Points

**Customer buys a $50 T-shirt:**

```bash
curl -X POST http://localhost:3000/api/transaction \
  -H "Content-Type: application/json" \
  -d '{
    "posSystemId": "square",
    "merchantId": "mall_store_001",
    "customerPhone": "+1234567890",
    "customerFirstName": "Alice",
    "totalAmount": 50,
    "items": [{
      "productId": "tshirt_001",
      "name": "Premium T-Shirt",
      "quantity": 1,
      "unitPrice": 50,
      "category": "clothing"
    }]
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_xxx",
    "customerId": "cust_xxx",
    "pointsEarned": 750,
    "pointsBalance": 750,
    "discountApplied": 0,
    "finalAmount": 50,
    "voucherGenerated": {
      "code": "REWARD-XYZ789",
      "discountType": "percentage",
      "discountValue": 5,
      "validUntil": "2024-XX-XX"
    },
    "message": "Earned 750 points! Voucher generated: REWARD-XYZ789"
  }
}
```

### 2. Second Visit - Lookup Customer

**Cashier enters customer's phone number:**

```bash
curl http://localhost:3000/api/customer/+1234567890?merchantId=mall_store_001
```

**Response:**
```json
{
  "success": true,
  "data": {
    "exists": true,
    "customer": {
      "id": "cust_xxx",
      "phoneNumber": "+1234567890",
      "firstName": "Alice"
    },
    "pointsBalance": 0,
    "activeVouchers": [{
      "code": "REWARD-XYZ789",
      "discountType": "percentage",
      "discountValue": 5,
      "minPurchaseAmount": 20,
      "maxDiscountAmount": 50,
      "validUntil": "2024-XX-XX"
    }],
    "availableRedemptions": []
  }
}
```

### 3. Apply Voucher Discount

**Customer makes another purchase and uses voucher:**

```bash
curl -X POST http://localhost:3000/api/transaction \
  -H "Content-Type: application/json" \
  -d '{
    "posSystemId": "square",
    "merchantId": "mall_store_001",
    "customerPhone": "+1234567890",
    "totalAmount": 100,
    "items": [{
      "productId": "jeans_001",
      "name": "Designer Jeans",
      "quantity": 1,
      "unitPrice": 100,
      "category": "clothing"
    }],
    "voucherCode": "REWARD-XYZ789"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionId": "txn_yyy",
    "customerId": "cust_xxx",
    "pointsEarned": 0,
    "pointsBalance": 0,
    "discountApplied": 5,
    "finalAmount": 95,
    "message": "Discount of $5.00 applied!"
  }
}
```

## Default Reward Rules

- **Points Rate**: 10 points per $1 spent
- **Bonus Categories**:
  - Clothing: 1.5x points
  - Electronics: 1.2x points
- **Minimum Purchase**: $5 to earn points
- **Voucher Thresholds**:
  - 100 points → 5% off (max $50, min $20 purchase)
  - 250 points → $10 off (min $50 purchase)
  - 500 points → 15% off (max $100, min $100 purchase)

## Integration with POS Systems

### Square Integration
The system supports two integration methods with Square:

**Method 1: Direct API Calls**
- Send transaction data directly to `/api/transaction` endpoint
- Best for custom integrations or when webhook setup is not possible

**Method 2: Webhooks (Recommended)**
- Configure Square webhooks to automatically send transaction data
- Real-time processing of payments and orders
- No manual API calls needed from POS system

### Clover Integration
The system supports two integration methods with Clover:

**Method 1: Direct API Calls**
- Send transaction data directly to `/api/transaction` endpoint
- Best for custom integrations

**Method 2: Webhooks (Recommended)**
- Configure Clover webhooks for automatic transaction processing
- Real-time updates when orders and payments are created/updated
- Seamless integration with existing Clover workflows

## OAuth Integration

The system now supports secure OAuth 2.0 connections to Square and Clover POS systems, following the [SalesArc OAuth Flow Architecture](https://dhruvdoshi.github.io/salesarc/integrations/oauth-flow).

### Features

- ✅ **Secure Token Storage**: Access tokens encrypted with AES-GCM
- ✅ **HMAC Webhook Verification**: Validates webhook signatures using stored secrets
- ✅ **Fast-Ack Processing**: Immediate webhook acknowledgment for reliability
- ✅ **State Management**: Encrypted OAuth state to prevent CSRF attacks
- ✅ **Token Refresh**: Automatic token renewal before expiration

### OAuth Flow

#### 1. Initiate Connection
```
POST /api/oauth/square/connect
Content-Type: application/json

{
  "merchantId": "merchant_123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://connect.squareup.com/oauth2/authorize?...",
    "state": "encrypted_state_string"
  }
}
```

#### 2. Merchant Authorization
- Redirect merchant to the `authorizationUrl`
- Merchant logs in and grants permissions
- POS system redirects to your callback URL

#### 3. Handle Callback
The callback is automatically handled at:
```
GET /api/oauth/square/callback?code=auth_code&state=encrypted_state
```

#### 4. Check Connection Status
```
GET /api/oauth/square/status?merchantId=merchant_123
```

**Response:**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "connectionId": "conn_xxx",
    "provider": "square",
    "merchantAccountId": "sq0idb-...",
    "status": "connected",
    "lastConnectedAt": "2024-01-01T12:00:00Z",
    "tokenExpiresAt": "2024-01-01T13:00:00Z"
  }
}
```

### Environment Variables

Add these to your `.env` file:

```env
# Encryption (generate a secure 32-character key)
ENCRYPTION_KEY=your-32-character-encryption-key-here

# Square OAuth
SQUARE_APPLICATION_ID=your_square_app_id
SQUARE_ACCESS_TOKEN=your_square_access_token

# Clover OAuth
CLOVER_APPLICATION_ID=your_clover_app_id
CLOVER_APP_SECRET=your_clover_app_secret

# Server
BASE_URL=https://your-domain.com
NODE_ENV=production
```

### Webhook Security

Webhooks are now verified using the OAuth-stored webhook secrets:

- **Square**: HMAC-SHA256 with base64 encoding
- **Clover**: HMAC-SHA256 with hex encoding
- **Fast-Ack**: Immediate 200 response, async processing
- **Idempotency**: Prevents duplicate processing

### Example OAuth Setup

```bash
# 1. Initiate Square connection
curl -X POST http://localhost:9844/api/oauth/square/connect \
  -H "Content-Type: application/json" \
  -d '{"merchantId": "merchant_123"}'

# 2. Redirect merchant to authorizationUrl (manually or in app)

# 3. Check connection status
curl "http://localhost:9844/api/oauth/square/status?merchantId=merchant_123"
```

## Database Migration (Production)

For production, replace the in-memory database with:

```typescript
// Example: PostgreSQL with Prisma
// prisma/schema.prisma
model Customer {
  id        String   @id @default(uuid())
  phoneNumber String @unique
  email     String?
  firstName String?
  lastName  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  transactions Transaction[]
  points    RewardPoint[]
  vouchers  Voucher[]
}
```

## License

ISC
