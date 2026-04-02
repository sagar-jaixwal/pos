/**
 * Main Application Entry Point
 * POS Rewards System Server
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'POS Rewards System API',
    version: '1.0.0',
    description: 'A rewards system that integrates with POS systems like Square and Clover',
    endpoints: {
      health: 'GET /api/health',
      transaction: 'POST /api/transaction',
      customer: 'GET /api/customer/:phoneNumber',
      customerRedeem: 'POST /api/customer/:phoneNumber/redeem',
      customerHistory: 'GET /api/customer/:phoneNumber/history',
      merchantRule: 'GET /api/merchant/:merchantId/rule',
      updateMerchantRule: 'PUT /api/merchant/:merchantId/rule',
      squareWebhook: 'POST /api/webhooks/square',
      cloverWebhook: 'POST /api/webhooks/clover',
      oauthConnect: 'POST /api/oauth/:provider/connect',
      oauthCallback: 'GET /api/oauth/:provider/callback',
      oauthStatus: 'GET /api/oauth/:provider/status'
    },
    documentation: {
      overview: 'This system automatically calculates reward points after each purchase and supports secure OAuth connections to POS systems',
      features: [
        'OAuth 2.0 integration with Square and Clover POS systems',
        'Encrypted token storage with AES-GCM encryption',
        'HMAC webhook signature verification',
        'Fast-ack webhook processing for reliability',
        'Automatic point calculation based on purchase amount',
        'Bonus points for specific categories',
        'Voucher generation when points reach thresholds',
        'Voucher redemption for discounts on future purchases',
        'Customer wallet management via phone number lookup'
      ],
      oauthFlow: [
        '1. POST /api/oauth/square/connect - Initiate Square OAuth',
        '2. Redirect merchant to authorization URL',
        '3. Square redirects to /api/oauth/square/callback',
        '4. System exchanges code for tokens and stores encrypted',
        '5. Webhooks verified using stored webhook secrets'
      ],
      flow: [
        '1. Customer makes purchase at POS (Square/Clover)',
        '2. POS sends transaction data to this API',
        '3. System calculates and awards points',
        '4. If enough points, auto-generates voucher',
        '5. On next visit, customer enters phone number',
        '6. System retrieves available vouchers/discounts',
        '7. Cashier applies voucher code to transaction'
      ]
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           POS Rewards System Server                       ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                ║
║                                                           ║
║  Quick Start:                                             ║
║  1. POST /api/transaction - Process a purchase            ║
║  2. GET /api/customer/:phone - Lookup customer wallet     ║
║  3. POST /api/customer/:phone/redeem - Get a voucher      ║
║                                                           ║
║  See root endpoint (/) for full API documentation         ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
