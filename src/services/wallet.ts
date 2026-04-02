/**
 * Wallet Service
 * Manages customer wallet, vouchers, and redemptions
 * Based on SalesArc Wallet Architecture
 */

import { randomUUID } from 'crypto';
import { db, Customer, Voucher, Redemption, Transaction } from '../models';
import { rewardEngine } from './reward-engine';

export class WalletService {
  
  /**
   * Find or create customer by phone number
   */
  findOrCreateCustomer(phoneNumber: string, data?: Partial<Customer>): Customer {
    // Check if customer exists
    let customer = db.customerByPhone.get(phoneNumber);

    if (!customer) {
      // Create new customer
      customer = {
        id: randomUUID(),
        phoneNumber,
        email: data?.email,
        firstName: data?.firstName,
        lastName: data?.lastName,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      db.customers.set(customer.id, customer);
      db.customerByPhone.set(phoneNumber, customer);
      
      // Initialize indexes
      db.pointsByCustomer.set(customer.id, []);
      db.vouchersByCustomer.set(customer.id, []);
      db.transactionsByCustomer.set(customer.id, []);
    } else if (data) {
      // Update existing customer if new data provided
      customer = {
        ...customer,
        ...data,
        updatedAt: new Date()
      };
      db.customers.set(customer.id, customer);
      db.customerByPhone.set(phoneNumber, customer);
    }

    return customer;
  }

  /**
   * Get customer by phone number
   */
  getCustomerByPhone(phoneNumber: string): Customer | undefined {
    return db.customerByPhone.get(phoneNumber);
  }

  /**
   * Get customer's wallet summary (points + vouchers)
   */
  getWalletSummary(customerId: string, ruleId: string) {
    const customer = db.customers.get(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }

    const pointsBalance = rewardEngine.getPointsBalance(customerId);
    const activeVouchers = rewardEngine.getActiveVouchers(customerId);
    const rule = db.rewardRules.get(ruleId);

    const availableVouchers: any[] = [];
    if (rule) {
      availableVouchers.push(...rewardEngine.getAvailableVouchers(customerId, rule));
    }

    return {
      customer: {
        id: customer.id,
        phoneNumber: customer.phoneNumber,
        firstName: customer.firstName,
        lastName: customer.lastName
      },
      pointsBalance,
      activeVouchers: activeVouchers.map(v => ({
        code: v.code,
        discountType: v.discountType,
        discountValue: v.discountValue,
        minPurchaseAmount: v.minPurchaseAmount,
        maxDiscountAmount: v.maxDiscountAmount,
        validUntil: v.validUntil
      })),
      availableRedemptions: availableVouchers
    };
  }

  /**
   * Redeem points for a voucher
   */
  redeemPointsForVoucher(
    customerId: string,
    thresholdIndex: number,
    ruleId: string
  ): Voucher {
    const rule = db.rewardRules.get(ruleId);
    if (!rule) {
      throw new Error('Reward rule not found');
    }

    const availableVouchers = rewardEngine.getAvailableVouchers(customerId, rule);
    
    if (thresholdIndex < 0 || thresholdIndex >= availableVouchers.length) {
      throw new Error('Invalid voucher threshold');
    }

    const threshold = availableVouchers[thresholdIndex];
    return rewardEngine.generateVoucher(customerId, threshold, threshold.pointsRequired);
  }

  /**
   * Apply voucher to a transaction
   */
  applyVoucherToTransaction(
    voucherCode: string,
    transactionAmount: number,
    customerId: string,
    transactionId: string
  ): { success: boolean; discountApplied: number; message: string; finalAmount: number } {
    const result = rewardEngine.applyVoucher(voucherCode, transactionAmount);

    if (result.success && result.voucher) {
      // Record redemption
      const redemption: Redemption = {
        id: randomUUID(),
        customerId,
        voucherId: result.voucher.id,
        transactionId,
        discountApplied: result.discountApplied,
        redeemedAt: new Date()
      };

      db.redemptions.set(redemption.id, redemption);
    }

    return {
      ...result,
      finalAmount: transactionAmount - result.discountApplied
    };
  }

  /**
   * Get customer's transaction history
   */
  getCustomerTransactions(customerId: string): Transaction[] {
    return db.transactionsByCustomer.get(customerId) || [];
  }

  /**
   * Get customer's points history
   */
  getPointsHistory(customerId: string) {
    const points = db.pointsByCustomer.get(customerId) || [];
    return points.map(p => ({
      id: p.id,
      pointsEarned: p.pointsEarned,
      pointsBalance: p.pointsBalance,
      earnedAt: p.earnedAt,
      expiresAt: p.expiresAt,
      status: p.status,
      transactionId: p.transactionId
    }));
  }

  /**
   * Get customer's voucher history
   */
  getVoucherHistory(customerId: string) {
    const vouchers = db.vouchersByCustomer.get(customerId) || [];
    return vouchers.map(v => ({
      id: v.id,
      code: v.code,
      discountType: v.discountType,
      discountValue: v.discountValue,
      pointsRequired: v.pointsRequired,
      status: v.status,
      validFrom: v.validFrom,
      validUntil: v.validUntil,
      usedAt: v.usedAt,
      createdAt: v.createdAt
    }));
  }
}

export const walletService = new WalletService();
