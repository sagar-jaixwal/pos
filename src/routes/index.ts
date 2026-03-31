/**
 * API Routes for POS Rewards System
 */

import { Router, Request, Response } from 'express';
import { posAdapter, POSTransactionRequest } from '../services/pos-adapter';
import { walletService } from '../services/wallet';
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
