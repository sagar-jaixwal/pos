/**
 * POS Adapter Service
 * Integrates with external POS systems (Square, Clover, etc.)
 * Based on SalesArc POS Adapter Architecture
 */

import { randomUUID } from 'crypto';
import { db, Transaction, TransactionItem, RewardRule } from '../models';
import { rewardEngine } from './reward-engine';
import { walletService } from './wallet';

export interface POSTransactionRequest {
  posSystemId: string; // 'square', 'clover', etc.
  merchantId: string;
  customerId?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerFirstName?: string;
  customerLastName?: string;
  totalAmount: number;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    category?: string;
  }>;
  voucherCode?: string;
}

export interface POSTransactionResponse {
  transactionId: string;
  customerId: string;
  pointsEarned: number;
  pointsBalance: number;
  discountApplied: number;
  finalAmount: number;
  voucherGenerated?: {
    code: string;
    discountType: string;
    discountValue: number;
    validUntil: Date;
  };
  message: string;
}

export class POSAdapterService {
  
  /**
   * Process a transaction from POS system
   * This is the main entry point when cashier completes a sale
   */
  async processTransaction(request: POSTransactionRequest): Promise<POSTransactionResponse> {
    const {
      posSystemId,
      merchantId,
      customerPhone,
      customerEmail,
      customerFirstName,
      customerLastName,
      totalAmount,
      items,
      voucherCode
    } = request;

    // Get or create reward rule for this merchant
    let rule = db.rewardRules.get(merchantId);
    if (!rule) {
      // Create default rule if not exists
      rule = this.createDefaultRewardRule(merchantId);
    }

    // Find or create customer
    let customerId: string;
    if (customerPhone) {
      const customer = walletService.findOrCreateCustomer(customerPhone, {
        email: customerEmail,
        firstName: customerFirstName,
        lastName: customerLastName
      });
      customerId = customer.id;
    } else {
      // Anonymous transaction - no points awarded
      return {
        transactionId: randomUUID(),
        customerId: 'anonymous',
        pointsEarned: 0,
        pointsBalance: 0,
        discountApplied: 0,
        finalAmount: totalAmount,
        message: 'Anonymous transaction - no rewards applied'
      };
    }

    // Create transaction record
    const transaction: Transaction = {
      id: randomUUID(),
      customerId,
      posSystemId,
      merchantId,
      totalAmount,
      items: items as TransactionItem[],
      status: 'completed',
      createdAt: new Date()
    };

    db.transactions.set(transaction.id, transaction);

    // Update customer transaction index
    if (!db.transactionsByCustomer.has(customerId)) {
      db.transactionsByCustomer.set(customerId, []);
    }
    db.transactionsByCustomer.get(customerId)!.push(transaction);

    // Apply voucher if provided
    let discountApplied = 0;
    let finalAmount = totalAmount;

    if (voucherCode) {
      const voucherResult = walletService.applyVoucherToTransaction(
        voucherCode,
        totalAmount,
        customerId,
        transaction.id
      );

      if (voucherResult.success) {
        discountApplied = voucherResult.discountApplied;
        finalAmount = voucherResult.finalAmount;
      }
    }

    // Calculate and award points (only if no voucher was used in this transaction)
    let pointsEarned = 0;
    let pointsBalance = 0;
    let voucherGenerated;

    if (!voucherCode || discountApplied === 0) {
      // Calculate points based on final amount paid
      pointsEarned = rewardEngine.calculatePoints(
        { ...transaction, totalAmount: finalAmount },
        rule
      );

      if (pointsEarned > 0) {
        const rewardPoint = rewardEngine.awardPoints(customerId, transaction, pointsEarned);
        pointsBalance = rewardPoint.pointsBalance;

        // Check if customer can redeem for a voucher
        const availableVouchers = rewardEngine.getAvailableVouchers(customerId, rule);
        if (availableVouchers.length > 0) {
          // Auto-generate voucher for the highest threshold customer can afford
          const bestThreshold = availableVouchers[availableVouchers.length - 1];
          const voucher = rewardEngine.generateVoucher(
            customerId,
            bestThreshold,
            bestThreshold.pointsRequired
          );

          voucherGenerated = {
            code: voucher.code,
            discountType: voucher.discountType,
            discountValue: voucher.discountValue,
            validUntil: voucher.validUntil
          };
        }
      }
    }

    return {
      transactionId: transaction.id,
      customerId,
      pointsEarned,
      pointsBalance,
      discountApplied,
      finalAmount,
      voucherGenerated,
      message: pointsEarned > 0
        ? `Earned ${pointsEarned} points!` + (voucherGenerated ? ` Voucher generated: ${voucherGenerated.code}` : '')
        : discountApplied > 0
          ? `Discount of $${discountApplied.toFixed(2)} applied!`
          : 'Transaction completed'
    };
  }

  /**
   * Get customer wallet info by phone number
   * Called when customer enters phone number at checkout
   */
  getCustomerWallet(phoneNumber: string, merchantId: string) {
    const customer = walletService.getCustomerByPhone(phoneNumber);
    
    if (!customer) {
      return {
        exists: false,
        message: 'Customer not found. First purchase?'
      };
    }

    const walletSummary = walletService.getWalletSummary(customer.id, merchantId);

    return {
      exists: true,
      ...walletSummary
    };
  }

  /**
   * Create default reward rule for a merchant
   */
  private createDefaultRewardRule(merchantId: string): RewardRule {
    const rule: RewardRule = {
      id: merchantId,
      merchantId,
      pointsPerDollar: 10, // 10 points per $1
      bonusCategories: {
        'clothing': 1.5, // 1.5x points for clothing
        'electronics': 1.2 // 1.2x points for electronics
      },
      minPurchaseForPoints: 5, // Minimum $5 to earn points
      voucherThresholds: [
        {
          pointsRequired: 100,
          discountType: 'percentage',
          discountValue: 5, // 5% off
          minPurchaseAmount: 20,
          maxDiscountAmount: 50,
          validityDays: 30
        },
        {
          pointsRequired: 250,
          discountType: 'fixed',
          discountValue: 10, // $10 off
          minPurchaseAmount: 50,
          maxDiscountAmount: 10,
          validityDays: 30
        },
        {
          pointsRequired: 500,
          discountType: 'percentage',
          discountValue: 15, // 15% off
          minPurchaseAmount: 100,
          maxDiscountAmount: 100,
          validityDays: 45
        }
      ],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    db.rewardRules.set(merchantId, rule);
    return rule;
  }

  /**
   * Update reward rule for a merchant
   */
  updateRewardRule(merchantId: string, updates: Partial<RewardRule>): RewardRule {
    const existingRule = db.rewardRules.get(merchantId);
    
    if (!existingRule) {
      throw new Error('Reward rule not found for merchant');
    }

    const updatedRule: RewardRule = {
      ...existingRule,
      ...updates,
      updatedAt: new Date()
    };

    db.rewardRules.set(merchantId, updatedRule);
    return updatedRule;
  }

  /**
   * Get reward rule for a merchant
   */
  getRewardRule(merchantId: string): RewardRule | undefined {
    return db.rewardRules.get(merchantId);
  }
}

export const posAdapter = new POSAdapterService();
