/**
 * Database Models for POS Rewards System
 * Based on SalesArc Data Model Architecture
 */

export interface Customer {
  id: string;
  phoneNumber: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  customerId: string;
  posSystemId: string; // Square, Clover, etc.
  merchantId: string;
  totalAmount: number;
  items: TransactionItem[];
  status: 'completed' | 'refunded' | 'cancelled';
  createdAt: Date;
}

export interface TransactionItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  category?: string;
}

export interface RewardPoint {
  id: string;
  customerId: string;
  transactionId: string;
  pointsEarned: number;
  pointsBalance: number;
  earnedAt: Date;
  expiresAt?: Date;
  status: 'active' | 'expired' | 'redeemed';
}

export interface Voucher {
  id: string;
  customerId: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  pointsRequired: number;
  validFrom: Date;
  validUntil: Date;
  status: 'active' | 'used' | 'expired';
  usedAt?: Date;
  usedTransactionId?: string;
  createdAt: Date;
}

export interface RewardRule {
  id: string;
  merchantId: string;
  pointsPerDollar: number;
  bonusCategories?: Record<string, number>; // category -> multiplier
  minPurchaseForPoints: number;
  voucherThresholds: VoucherThreshold[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VoucherThreshold {
  pointsRequired: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  validityDays: number;
}

export interface Redemption {
  id: string;
  customerId: string;
  voucherId: string;
  transactionId: string;
  discountApplied: number;
  redeemedAt: Date;
}

// In-memory database for demonstration
export class InMemoryDatabase {
  customers: Map<string, Customer> = new Map();
  transactions: Map<string, Transaction> = new Map();
  rewardPoints: Map<string, RewardPoint> = new Map();
  vouchers: Map<string, Voucher> = new Map();
  rewardRules: Map<string, RewardRule> = new Map();
  redemptions: Map<string, Redemption> = new Map();

  // Index by phone number for quick lookup
  customerByPhone: Map<string, Customer> = new Map();
  
  // Index by customer
  pointsByCustomer: Map<string, RewardPoint[]> = new Map();
  vouchersByCustomer: Map<string, Voucher[]> = new Map();
  transactionsByCustomer: Map<string, Transaction[]> = new Map();
}

export const db = new InMemoryDatabase();
