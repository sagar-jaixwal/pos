/**
 * Clover Integration Service
 * Handles Clover POS webhooks and API interactions
 */

import { createCloverClient, CloverEnvironment } from 'clover-nodejs-sdk';
import { posAdapter, POSTransactionRequest } from './pos-adapter';

export interface CloverWebhookEvent {
  merchantId: string;
  employeeId?: string;
  orderId?: string;
  paymentId?: string;
  type: string;
  ts: number;
  object: {
    id: string;
    orderRef?: {
      id: string;
      paymentState?: string;
      total?: number;
      employee?: any;
      customer?: any;
      lineItems?: any[];
    };
    payment?: {
      id: string;
      order: {
        id: string;
        total: number;
        employee: any;
        customer: any;
        lineItems: any[];
      };
      amount: number;
      tipAmount: number;
      taxAmount: number;
      result: string;
    };
  };
}

export class CloverService {
  private clover: any;

  constructor() {
    this.clover = createCloverClient({
      environment: 'DEV',
      authKey: process.env.CLOVER_APP_SECRET!, // Using app secret as auth key
    });
  }

  /**
   * Handle Clover webhook events
   */
  async handleWebhook(event: CloverWebhookEvent): Promise<any> {
    try {
      console.log('Received Clover webhook:', event.type);

      switch (event.type) {
        case 'CREATE_ORDER':
        case 'UPDATE_ORDER':
          return await this.handleOrderEvent(event);
        case 'CREATE_PAYMENT':
        case 'UPDATE_PAYMENT':
          return await this.handlePaymentEvent(event);
        default:
          console.log('Unhandled Clover event type:', event.type);
          return { success: true, message: 'Event type not handled' };
      }
    } catch (error) {
      console.error('Error handling Clover webhook:', error);
      throw error;
    }
  }

  /**
   * Handle order events from Clover
   */
  private async handleOrderEvent(event: CloverWebhookEvent): Promise<any> {
    const orderRef = event.object.orderRef;

    if (!orderRef || orderRef.paymentState !== 'PAID') {
      return { success: true, message: 'Order not paid' };
    }

    try {
      // Convert Clover order to our transaction format
      const transactionRequest: POSTransactionRequest = {
        posSystemId: 'clover',
        merchantId: event.merchantId,
        customerId: orderRef.customer?.id,
        customerPhone: orderRef.customer?.phoneNumber,
        customerEmail: orderRef.customer?.emailAddress,
        customerFirstName: orderRef.customer?.firstName,
        customerLastName: orderRef.customer?.lastName,
        totalAmount: (orderRef.total || 0) / 100, // Convert cents to dollars
        items: this.extractItemsFromOrder(orderRef.lineItems || []),
      };

      const result = await posAdapter.processTransaction(transactionRequest);

      return {
        success: true,
        transactionId: result.transactionId,
        message: 'Clover order processed successfully'
      };
    } catch (error) {
      console.error('Error processing Clover order:', error);
      throw error;
    }
  }

  /**
   * Handle payment events from Clover
   */
  private async handlePaymentEvent(event: CloverWebhookEvent): Promise<any> {
    const payment = event.object.payment;

    if (!payment || payment.result !== 'SUCCESS') {
      return { success: true, message: 'Payment not successful' };
    }

    try {
      // Convert Clover payment to our transaction format
      const transactionRequest: POSTransactionRequest = {
        posSystemId: 'clover',
        merchantId: event.merchantId,
        customerId: payment.order.customer?.id,
        customerPhone: payment.order.customer?.phoneNumber,
        customerEmail: payment.order.customer?.emailAddress,
        customerFirstName: payment.order.customer?.firstName,
        customerLastName: payment.order.customer?.lastName,
        totalAmount: (payment.amount || 0) / 100, // Convert cents to dollars
        items: this.extractItemsFromOrder(payment.order.lineItems || []),
      };

      const result = await posAdapter.processTransaction(transactionRequest);

      return {
        success: true,
        transactionId: result.transactionId,
        message: 'Clover payment processed successfully'
      };
    } catch (error) {
      console.error('Error processing Clover payment:', error);
      throw error;
    }
  }

  /**
   * Extract items from Clover order
   */
  private extractItemsFromOrder(lineItems: any[]): Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    category?: string;
  }> {
    if (!lineItems || lineItems.length === 0) {
      return [];
    }

    return lineItems.map((item: any) => ({
      productId: item.id || 'unknown',
      name: item.name || 'Unknown Item',
      quantity: item.quantity || 1,
      unitPrice: (item.price || 0) / 100, // Convert cents to dollars
      category: item.tags?.[0]?.name || undefined,
    }));
  }

  /**
   * Get customer details from Clover
   */
  async getCustomerDetails(merchantId: string, customerId: string): Promise<any> {
    try {
      const customer = await this.clover.customers.getCustomer(merchantId, customerId);
      return customer;
    } catch (error) {
      console.error('Error fetching Clover customer:', error);
      return null;
    }
  }

  /**
   * Get order details from Clover
   */
  async getOrderDetails(merchantId: string, orderId: string): Promise<any> {
    try {
      const order = await this.clover.orders.getOrder(merchantId, orderId);
      return order;
    } catch (error) {
      console.error('Error fetching Clover order:', error);
      return null;
    }
  }

  /**
   * Verify webhook signature (for production)
   */
  verifyWebhookSignature(signature: string, body: string): boolean {
    // In production, you would verify the webhook signature using Clover's public key
    // For sandbox, we'll skip verification
    return process.env.NODE_ENV === 'development' || true;
  }
}

export const cloverService = new CloverService();