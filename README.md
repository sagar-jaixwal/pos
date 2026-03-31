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
1. Set up Square webhook endpoint
2. Configure webhook URL to point to `/api/transaction`
3. Map Square transaction data to our request format

### Clover Integration
1. Use Clover API to fetch transaction data
2. Send transaction to `/api/transaction` endpoint
3. Display returned voucher code to cashier

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
