/**
 * Square Integration Service
 * Handles Square POS webhooks and API interactions
 */

import { SquareClient, SquareEnvironment } from "square";
import { posAdapter, POSTransactionRequest } from "./pos-adapter";
import crypto from "crypto";

export interface SquareWebhookEvent {
  merchant_id: string;
  location_id: string;
  type: string;
  event_id: string;
  created_at: string;
  data: {
    id: string;
    object: {
      payment?: any;
      order?: any;
      customer?: any;
    };
  };
}

export class SquareService {
  private client: SquareClient;

  constructor() {
    this.client = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN!,
      environment: "sandbox",
    });
  }

  /**
   * Handle Square webhook events
   */
  async handleWebhook(event: SquareWebhookEvent): Promise<any> {
    try {
      console.log("Received Square webhook:", event.type);

      switch (event.type) {
        case "payment.created":
        case "payment.updated":
          return await this.handlePaymentEvent(event);
        case "order.created":
        case "order.updated":
          return await this.handleOrderEvent(event);
        default:
          console.log("Unhandled Square event type:", event.type);
          return { success: true, message: "Event type not handled" };
      }
    } catch (error) {
      console.error("Error handling Square webhook:", error);
      throw error;
    }
  }

  /**
   * Handle payment events from Square
   */
  private async handlePaymentEvent(event: SquareWebhookEvent): Promise<any> {
    const payment = event.data.object.payment;

    if (!payment || payment.status !== "COMPLETED") {
      return { success: true, message: "Payment not completed" };
    }

    try {
      // Get order details if available
      let orderDetails = null;
      if (payment.order_id) {
        try {
          const orderResponse = await this.client.orders.get({
            orderId: payment.order_id,
          });
          orderDetails = orderResponse.order;
        } catch (error) {
          console.warn("Could not fetch order details:", error);
        }
      }

      // Convert Square payment to our transaction format
      const transactionRequest: POSTransactionRequest = {
        posSystemId: "square",
        merchantId: event.merchant_id,
        customerId: payment.customer_id,
        totalAmount: parseFloat(payment.amount_money.amount) / 100, // Convert cents to dollars
        items: this.extractItemsFromOrder(orderDetails),
        // Square doesn't provide customer phone/email in webhook, would need separate API call
      };

      const result = await posAdapter.processTransaction(transactionRequest);

      return {
        success: true,
        transactionId: result.transactionId,
        message: "Square payment processed successfully",
      };
    } catch (error) {
      console.error("Error processing Square payment:", error);
      throw error;
    }
  }

  /**
   * Handle order events from Square
   */
  private async handleOrderEvent(event: SquareWebhookEvent): Promise<any> {
    const order = event.data.object.order;

    if (!order || order.state !== "COMPLETED") {
      return { success: true, message: "Order not completed" };
    }

    try {
      // Convert Square order to our transaction format
      const transactionRequest: POSTransactionRequest = {
        posSystemId: "square",
        merchantId: event.merchant_id,
        customerId: order.customer_id,
        totalAmount: parseFloat(order.total_money.amount) / 100, // Convert cents to dollars
        items: this.extractItemsFromOrder(order),
      };

      const result = await posAdapter.processTransaction(transactionRequest);

      return {
        success: true,
        transactionId: result.transactionId,
        message: "Square order processed successfully",
      };
    } catch (error) {
      console.error("Error processing Square order:", error);
      throw error;
    }
  }

  /**
   * Extract items from Square order
   */
  private extractItemsFromOrder(order: any): Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    category?: string;
  }> {
    if (!order || !order.line_items) {
      return [];
    }

    return order.line_items.map((item: any) => ({
      productId: item.catalog_object_id || item.uid || "unknown",
      name: item.name || "Unknown Item",
      quantity: parseInt(item.quantity) || 1,
      unitPrice: parseFloat(item.base_price_money?.amount || 0) / 100,
      category: item.item_type || undefined,
    }));
  }

  /**
   * Get customer details from Square
   */
  async getCustomerDetails(customerId: string): Promise<any> {
    try {
      const response = await this.client.customers.get({ customerId });
      return response.customer;
    } catch (error) {
      console.error("Error fetching Square customer:", error);
      return null;
    }
  }

  /**
   * Verify webhook signature (for production)
   */
  //   verifyWebhookSignature(signature: string, body: string): boolean {
  //     // In production, you would verify the webhook signature using Square's public key
  //     // For sandbox, we'll skip verification
  //     return process.env.NODE_ENV === 'development' || true;
  //   }

  verifyWebhookSignature(signature: string, body: string): boolean {
    const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

    if (!key) {
      throw new Error("SQUARE_WEBHOOK_SIGNATURE_KEY is not defined");
    }

    const hash = crypto.createHmac("sha256", key).update(body).digest("base64");

    return hash === signature;
  }
}

export const squareService = new SquareService();
