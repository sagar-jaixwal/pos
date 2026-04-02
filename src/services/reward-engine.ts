/**
 * Reward Engine Service
 * Calculates reward points based on purchase transactions
 * Based on SalesArc Reward Engine Architecture
 */

import { randomUUID } from 'crypto';
import { db, Transaction, RewardPoint, Voucher, RewardRule, VoucherThreshold } from '../models';

export class RewardEngineService {
  
  /**
   * Calculate reward points for a transaction
   * Formula: basePoints + bonusPoints
   */
  calculatePoints(transaction: Transaction, rule: RewardRule): number {
    if (transaction.totalAmount < rule.minPurchaseForPoints) {
      return 0;
    }

    // Base points: points per dollar spent
    let basePoints = Math.floor(transaction.totalAmount * rule.pointsPerDollar);

    // Bonus points for specific categories
    if (rule.bonusCategories) {
      transaction.items.forEach(item => {
        if (item.category && rule.bonusCategories![item.category]) {
          const multiplier = rule.bonusCategories![item.category];
          const itemPoints = Math.floor((item.quantity * item.unitPrice) * rule.pointsPerDollar);
          basePoints += itemPoints * (multiplier - 1); // Add bonus portion
        }
      });
    }

    return basePoints;
  }

  /**
   * Award points to customer after a successful transaction
   */
  awardPoints(customerId: string, transaction: Transaction, pointsEarned: number): RewardPoint {
    const existingPoints = Array.from(db.rewardPoints.values())
      .filter(p => p.customerId === customerId && p.status === 'active');
    
    const currentBalance = existingPoints.reduce((sum, p) => sum + p.pointsBalance, 0);
    const newBalance = currentBalance + pointsEarned;

    const rewardPoint: RewardPoint = {
      id: randomUUID(),
      customerId,
      transactionId: transaction.id,
      pointsEarned,
      pointsBalance: newBalance,
      earnedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year expiry
      status: 'active'
    };

    db.rewardPoints.set(rewardPoint.id, rewardPoint);

    // Update index
    if (!db.pointsByCustomer.has(customerId)) {
      db.pointsByCustomer.set(customerId, []);
    }
    db.pointsByCustomer.get(customerId)!.push(rewardPoint);

    return rewardPoint;
  }

  /**
   * Get available voucher thresholds based on customer's points
   */
  getAvailableVouchers(customerId: string, rule: RewardRule): VoucherThreshold[] {
    const activePoints = Array.from(db.rewardPoints.values())
      .filter(p => p.customerId === customerId && p.status === 'active');
    
    const totalPoints = activePoints.reduce((sum, p) => sum + p.pointsBalance, 0);

    // Return vouchers customer can afford with their points
    return rule.voucherThresholds
      .filter(threshold => threshold.pointsRequired <= totalPoints)
      .sort((a, b) => a.pointsRequired - b.pointsRequired);
  }

  /**
   * Generate a voucher when customer redeems points
   */
  generateVoucher(
    customerId: string,
    threshold: VoucherThreshold,
    pointsToRedeem: number
  ): Voucher {
    // Deduct points from customer's active points (FIFO)
    let remainingPointsToDeduct = pointsToRedeem;
    const activePoints = Array.from(db.rewardPoints.values())
      .filter(p => p.customerId === customerId && p.status === 'active')
      .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime()); // Oldest first

    for (const point of activePoints) {
      if (remainingPointsToDeduct <= 0) break;

      if (point.pointsBalance <= remainingPointsToDeduct) {
        remainingPointsToDeduct -= point.pointsBalance;
        point.pointsBalance = 0;
        point.status = 'redeemed';
      } else {
        point.pointsBalance -= remainingPointsToDeduct;
        remainingPointsToDeduct = 0;
      }
    }

    // Recalculate balances for remaining active points
    const remainingActivePoints = activePoints.filter(p => p.status === 'active');
    let cumulativeBalance = 0;
    for (let i = remainingActivePoints.length - 1; i >= 0; i--) {
      cumulativeBalance += remainingActivePoints[i].pointsEarned;
      remainingActivePoints[i].pointsBalance = cumulativeBalance;
    }

    // Generate voucher
    const voucher: Voucher = {
      id: randomUUID(),
      customerId,
      code: `REWARD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      discountType: threshold.discountType,
      discountValue: threshold.discountValue,
      minPurchaseAmount: threshold.minPurchaseAmount,
      maxDiscountAmount: threshold.maxDiscountAmount,
      pointsRequired: pointsToRedeem,
      validFrom: new Date(),
      validUntil: new Date(Date.now() + threshold.validityDays * 24 * 60 * 60 * 1000),
      status: 'active',
      createdAt: new Date()
    };

    db.vouchers.set(voucher.id, voucher);

    // Update index
    if (!db.vouchersByCustomer.has(customerId)) {
      db.vouchersByCustomer.set(customerId, []);
    }
    db.vouchersByCustomer.get(customerId)!.push(voucher);

    return voucher;
  }

  /**
   * Apply voucher discount to a transaction
   */
  applyVoucher(voucherCode: string, transactionAmount: number): { 
    success: boolean; 
    discountApplied: number; 
    message: string;
    voucher?: Voucher;
  } {
    // Find voucher by code
    const voucher = Array.from(db.vouchers.values()).find(v => v.code === voucherCode);

    if (!voucher) {
      return { success: false, discountApplied: 0, message: 'Voucher not found' };
    }

    if (voucher.status !== 'active') {
      return { success: false, discountApplied: 0, message: `Voucher is ${voucher.status}` };
    }

    if (new Date() < voucher.validFrom) {
      return { success: false, discountApplied: 0, message: 'Voucher not yet valid' };
    }

    if (new Date() > voucher.validUntil) {
      voucher.status = 'expired';
      return { success: false, discountApplied: 0, message: 'Voucher expired' };
    }

    if (voucher.minPurchaseAmount && transactionAmount < voucher.minPurchaseAmount) {
      return { 
        success: false, 
        discountApplied: 0, 
        message: `Minimum purchase of $${voucher.minPurchaseAmount} required` 
      };
    }

    // Calculate discount
    let discountApplied: number;
    if (voucher.discountType === 'percentage') {
      discountApplied = (transactionAmount * voucher.discountValue) / 100;
    } else {
      discountApplied = voucher.discountValue;
    }

    // Apply max discount cap
    if (voucher.maxDiscountAmount && discountApplied > voucher.maxDiscountAmount) {
      discountApplied = voucher.maxDiscountAmount;
    }

    // Ensure discount doesn't exceed transaction amount
    if (discountApplied > transactionAmount) {
      discountApplied = transactionAmount;
    }

    // Mark voucher as used
    voucher.status = 'used';
    voucher.usedAt = new Date();

    return {
      success: true,
      discountApplied,
      message: `Discount of $${discountApplied.toFixed(2)} applied`,
      voucher
    };
  }

  /**
   * Get customer's total active points balance
   */
  getPointsBalance(customerId: string): number {
    const activePoints = Array.from(db.rewardPoints.values())
      .filter(p => p.customerId === customerId && p.status === 'active');
    
    return activePoints.reduce((sum, p) => sum + p.pointsBalance, 0);
  }

  /**
   * Get customer's active vouchers
   */
  getActiveVouchers(customerId: string): Voucher[] {
    const customerVouchers = db.vouchersByCustomer.get(customerId) || [];
    return customerVouchers.filter(v => v.status === 'active' && new Date() <= v.validUntil);
  }
}

export const rewardEngine = new RewardEngineService();
