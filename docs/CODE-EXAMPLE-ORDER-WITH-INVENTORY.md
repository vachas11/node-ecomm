# Complete Order Creation with Inventory Management - Code Implementation

Based on the architecture diagram, here's how you'd write the code for creating an order with inventory management.

---

## 📁 File Structure

```
services/order-service/
├── src/
│   ├── controllers/order.controller.ts    # HTTP handler
│   ├── services/order.service.ts          # Business logic (THIS IS THE MAIN FILE)
│   ├── repositories/order.repository.ts   # Database operations
│   ├── models/Order.ts                    # Domain model
│   ├── lib/messageQueue.ts                # RabbitMQ/Kafka client
│   └── clients/
│       ├── userServiceClient.ts           # HTTP client to User Service
│       ├── productServiceClient.ts        # HTTP client to Product Service
│       └── paymentServiceClient.ts        # HTTP client to Payment Service
```

---

## 1️⃣ ORDER CONTROLLER (HTTP Layer)

**File:** `services/order-service/src/controllers/order.controller.ts`

```typescript
import { Request, Response } from 'express';
import { OrderService } from '../services/order.service';
import { asyncHandler } from '../../../../shared/errors';

interface AuthenticatedRequest extends Request {
  user?: { userId: number; email: string; role: string };
}

interface CreateOrderRequest {
  products: Array<{
    productId: number;
    quantity: number;
  }>;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

export function createOrderController(orderService: OrderService) {
  /**
   * POST /api/orders
   * Creates a new order with inventory validation
   */
  const createOrder = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const orderData: CreateOrderRequest = req.body;

    // Delegate to service layer
    const order = await orderService.createOrder(userId, orderData);

    res.status(201).json({
      success: true,
      data: {
        order: order.toJSON()
      }
    });
  });

  return { createOrder };
}
```

---

## 2️⃣ ORDER SERVICE (Business Logic Layer) - **THE MAIN FILE**

**File:** `services/order-service/src/services/order.service.ts`

```typescript
import { Order } from '../models/Order';
import { OrderRepository } from '../repositories/order.repository';
import { UserServiceClient } from '../clients/userServiceClient';
import { ProductServiceClient } from '../clients/productServiceClient';
import { PaymentServiceClient } from '../clients/paymentServiceClient';
import { MessageQueue } from '../lib/messageQueue';
import { NotFoundError, ValidationError, ConflictError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';

interface CreateOrderData {
  products: Array<{
    productId: number;
    quantity: number;
  }>;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
}

export class OrderService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly userServiceClient: UserServiceClient,
    private readonly productServiceClient: ProductServiceClient,
    private readonly paymentServiceClient: PaymentServiceClient,
    private readonly messageQueue: MessageQueue
  ) {}

  /**
   * Creates an order with full validation:
   * 1. Validate user exists and is active
   * 2. Check product inventory availability
   * 3. Calculate total amount
   * 4. Create order in database
   * 5. Process payment
   * 6. Update order status
   * 7. Publish events to message queue
   */
  async createOrder(userId: number, orderData: CreateOrderData): Promise<Order> {
    logger.info('Creating order', { userId, productCount: orderData.products.length });

    // ========================================
    // STEP 1: Validate User
    // ========================================
    const user = await this.userServiceClient.validateUser(userId);
    if (!user.isActive) {
      throw new ValidationError('User account is not active');
    }
    logger.info('User validated', { userId, email: user.email });

    // ========================================
    // STEP 2: Check Inventory Availability
    // ========================================
    const inventoryCheck = await this.productServiceClient.checkInventory(
      orderData.products
    );

    if (!inventoryCheck.available) {
      throw new ConflictError('One or more products are out of stock', {
        unavailableProducts: inventoryCheck.unavailableProducts
      });
    }
    logger.info('Inventory validated', { 
      products: inventoryCheck.items.map(p => ({ id: p.productId, inStock: p.inStock }))
    });

    // ========================================
    // STEP 3: Calculate Total Amount
    // ========================================
    const totalAmount = inventoryCheck.items.reduce((sum, item) => {
      const orderItem = orderData.products.find(p => p.productId === item.productId);
      return sum + (item.price * orderItem!.quantity);
    }, 0);

    logger.info('Total calculated', { totalAmount });

    // ========================================
    // STEP 4: Create Order in Database (Status: pending)
    // ========================================
    const order = await this.orderRepository.create({
      userId,
      totalAmount,
      status: 'pending',
      shippingAddress: orderData.shippingAddress,
      items: orderData.products.map(p => {
        const productInfo = inventoryCheck.items.find(item => item.productId === p.productId)!;
        return {
          productId: p.productId,
          quantity: p.quantity,
          price: productInfo.price,
          productName: productInfo.name
        };
      })
    });

    if (!order) {
      throw new Error('Failed to create order');
    }

    logger.info('Order created in database', { orderId: order.id, status: 'pending' });

    // ========================================
    // STEP 5: Publish "order.created" Event
    // ========================================
    // This is async - Product Service will listen and reserve inventory
    await this.messageQueue.publish('order.created', {
      orderId: order.id,
      userId: user.id,
      items: orderData.products,
      totalAmount,
      createdAt: new Date().toISOString()
    });

    logger.info('Published order.created event', { orderId: order.id });

    try {
      // ========================================
      // STEP 6: Process Payment
      // ========================================
      const payment = await this.paymentServiceClient.processPayment({
        orderId: order.id,
        amount: totalAmount,
        userId: user.id,
        paymentMethod: 'credit_card' // In real app, this comes from request
      });

      logger.info('Payment processed', { 
        orderId: order.id, 
        transactionId: payment.transactionId 
      });

      // ========================================
      // STEP 7: Update Order Status to "paid"
      // ========================================
      const updatedOrder = await this.orderRepository.updateStatus(
        order.id,
        'paid',
        payment.transactionId
      );

      if (!updatedOrder) {
        throw new Error('Failed to update order status');
      }

      // ========================================
      // STEP 8: Publish "order.confirmed" Event
      // ========================================
      // Product Service will deduct inventory
      // Notification Service will send confirmation email
      await this.messageQueue.publish('order.confirmed', {
        orderId: updatedOrder.id,
        userId: user.id,
        userEmail: user.email,
        items: orderData.products.map(p => {
          const productInfo = inventoryCheck.items.find(item => item.productId === p.productId)!;
          return {
            productId: p.productId,
            productName: productInfo.name,
            quantity: p.quantity,
            price: productInfo.price
          };
        }),
        totalAmount,
        transactionId: payment.transactionId,
        shippingAddress: orderData.shippingAddress,
        confirmedAt: new Date().toISOString()
      });

      logger.info('Published order.confirmed event', { orderId: updatedOrder.id });

      return updatedOrder;

    } catch (error: any) {
      // ========================================
      // STEP 9: Handle Payment Failure
      // ========================================
      logger.error('Payment failed', { orderId: order.id, error: error.message });

      // Update order status to "payment_failed"
      await this.orderRepository.updateStatus(order.id, 'payment_failed');

      // Publish "order.cancelled" event so Product Service can release reserved inventory
      await this.messageQueue.publish('order.cancelled', {
        orderId: order.id,
        userId: user.id,
        items: orderData.products,
        reason: 'payment_failed',
        cancelledAt: new Date().toISOString()
      });

      logger.info('Published order.cancelled event', { orderId: order.id });

      throw error;
    }
  }
}
```

---

## 3️⃣ SERVICE CLIENTS (External Service Communication)

### 3A. User Service Client

**File:** `services/order-service/src/clients/userServiceClient.ts`

```typescript
import axios from 'axios';
import { NotFoundError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';

interface UserValidationResponse {
  id: number;
  email: string;
  isActive: boolean;
  firstName: string;
  lastName: string;
}

export class UserServiceClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = process.env.USER_SERVICE_URL || 'http://localhost:3001') {
    this.baseUrl = baseUrl;
  }

  async validateUser(userId: number): Promise<UserValidationResponse> {
    try {
      const response = await axios.get<UserValidationResponse>(
        `${this.baseUrl}/internal/users/${userId}/validate`,
        { timeout: 5000 }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new NotFoundError('User not found');
      }

      logger.error('User service communication failed', { 
        userId, 
        error: error.message 
      });
      throw new Error('Failed to validate user');
    }
  }
}
```

### 3B. Product Service Client

**File:** `services/order-service/src/clients/productServiceClient.ts`

```typescript
import axios from 'axios';
import logger from '../../../../shared/logger';

interface InventoryCheckRequest {
  products: Array<{
    productId: number;
    quantity: number;
  }>;
}

interface InventoryCheckResponse {
  available: boolean;
  items: Array<{
    productId: number;
    name: string;
    price: number;
    inStock: number;
  }>;
  unavailableProducts?: Array<{
    productId: number;
    requested: number;
    available: number;
  }>;
}

export class ProductServiceClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002') {
    this.baseUrl = baseUrl;
  }

  async checkInventory(products: Array<{ productId: number; quantity: number }>): Promise<InventoryCheckResponse> {
    try {
      const response = await axios.post<InventoryCheckResponse>(
        `${this.baseUrl}/internal/products/check-inventory`,
        { products },
        { timeout: 5000 }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Product service communication failed', { 
        products, 
        error: error.message 
      });
      throw new Error('Failed to check inventory');
    }
  }
}
```

### 3C. Payment Service Client

**File:** `services/order-service/src/clients/paymentServiceClient.ts`

```typescript
import axios from 'axios';
import logger from '../../../../shared/logger';

interface ProcessPaymentRequest {
  orderId: number;
  amount: number;
  userId: number;
  paymentMethod: string;
}

interface ProcessPaymentResponse {
  transactionId: string;
  status: 'success' | 'failed';
  amount: number;
  processedAt: string;
}

export class PaymentServiceClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3004') {
    this.baseUrl = baseUrl;
  }

  async processPayment(paymentData: ProcessPaymentRequest): Promise<ProcessPaymentResponse> {
    try {
      const response = await axios.post<ProcessPaymentResponse>(
        `${this.baseUrl}/internal/payments/process`,
        paymentData,
        { timeout: 10000 } // Payment can take longer
      );

      if (response.data.status === 'failed') {
        throw new Error('Payment processing failed');
      }

      return response.data;
    } catch (error: any) {
      logger.error('Payment service communication failed', { 
        orderId: paymentData.orderId, 
        error: error.message 
      });
      throw new Error('Failed to process payment');
    }
  }
}
```

---

## 4️⃣ MESSAGE QUEUE CLIENT (RabbitMQ/Kafka)

**File:** `services/order-service/src/lib/messageQueue.ts`

```typescript
import amqp, { Connection, Channel } from 'amqplib';
import logger from '../../../../shared/logger';

export class MessageQueue {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly url: string;

  constructor(url: string = process.env.RABBITMQ_URL || 'amqp://localhost:5672') {
    this.url = url;
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.url);
      this.channel = await this.connection.createChannel();
      
      // Declare exchange for event-driven communication
      await this.channel.assertExchange('order-events', 'topic', { durable: true });
      
      logger.info('Connected to RabbitMQ');
    } catch (error: any) {
      logger.error('Failed to connect to RabbitMQ', { error: error.message });
      throw error;
    }
  }

  /**
   * Publish event to message queue
   * @param event - Event name (e.g., 'order.created', 'order.confirmed')
   * @param data - Event payload
   */
  async publish(event: string, data: any): Promise<void> {
    if (!this.channel) {
      throw new Error('Message queue not connected');
    }

    try {
      const message = JSON.stringify(data);
      this.channel.publish(
        'order-events',
        event, // Routing key
        Buffer.from(message),
        { persistent: true } // Survives broker restart
      );

      logger.info('Event published', { event, data });
    } catch (error: any) {
      logger.error('Failed to publish event', { event, error: error.message });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    logger.info('Disconnected from RabbitMQ');
  }
}
```

---

## 5️⃣ ORDER REPOSITORY (Database Layer)

**File:** `services/order-service/src/repositories/order.repository.ts`

```typescript
import { PrismaClient } from '../generated/prisma-client';
import { Order } from '../models/Order';

interface CreateOrderData {
  userId: number;
  totalAmount: number;
  status: string;
  shippingAddress: any;
  items: Array<{
    productId: number;
    quantity: number;
    price: number;
    productName: string;
  }>;
}

export class OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(orderData: CreateOrderData): Promise<Order | null> {
    const order = await this.prisma.order.create({
      data: {
        userId: orderData.userId,
        totalAmount: orderData.totalAmount,
        status: orderData.status,
        shippingAddress: JSON.stringify(orderData.shippingAddress),
        items: {
          create: orderData.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            productName: item.productName
          }))
        }
      },
      include: {
        items: true
      }
    });

    return Order.fromDatabase(order);
  }

  async updateStatus(
    orderId: number, 
    status: string, 
    transactionId?: string
  ): Promise<Order | null> {
    const order = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(transactionId && { transactionId }),
        updatedAt: new Date()
      },
      include: {
        items: true
      }
    });

    return Order.fromDatabase(order);
  }
}
```

---

## 6️⃣ PRODUCT SERVICE - INVENTORY UPDATE (Event Consumer)

**File:** `services/product-service/src/consumers/orderConsumer.ts`

```typescript
import { MessageQueue } from '../lib/messageQueue';
import { ProductRepository } from '../repositories/product.repository';
import logger from '../../../../shared/logger';

interface OrderConfirmedEvent {
  orderId: number;
  userId: number;
  items: Array<{
    productId: number;
    quantity: number;
  }>;
  confirmedAt: string;
}

export class OrderEventConsumer {
  constructor(
    private readonly messageQueue: MessageQueue,
    private readonly productRepository: ProductRepository
  ) {}

  /**
   * Listen to "order.confirmed" events and deduct inventory
   */
  async start(): Promise<void> {
    await this.messageQueue.subscribe('order.confirmed', async (event: OrderConfirmedEvent) => {
      logger.info('Received order.confirmed event', { orderId: event.orderId });

      try {
        // Deduct inventory for each product in the order
        for (const item of event.items) {
          await this.productRepository.deductInventory(
            item.productId,
            item.quantity
          );

          logger.info('Inventory deducted', {
            productId: item.productId,
            quantity: item.quantity,
            orderId: event.orderId
          });
        }

        // Check if any product is now low in stock
        for (const item of event.items) {
          const product = await this.productRepository.findById(item.productId);
          
          if (product && product.inventory < 10) {
            // Publish "inventory.low" event for admin notification
            await this.messageQueue.publish('inventory.low', {
              productId: product.id,
              productName: product.name,
              currentStock: product.inventory,
              threshold: 10
            });

            logger.warn('Low inventory detected', {
              productId: product.id,
              stock: product.inventory
            });
          }
        }

      } catch (error: any) {
        logger.error('Failed to deduct inventory', {
          orderId: event.orderId,
          error: error.message
        });
        // In production: implement retry logic or dead-letter queue
      }
    });

    logger.info('Order event consumer started');
  }
}
```

**Product Repository - Deduct Inventory Method:**

```typescript
// In services/product-service/src/repositories/product.repository.ts

async deductInventory(productId: number, quantity: number): Promise<boolean> {
  const result = await this.prisma.inventory.updateMany({
    where: {
      productId,
      quantity: { gte: quantity } // Only update if enough stock
    },
    data: {
      quantity: {
        decrement: quantity
      },
      updatedAt: new Date()
    }
  });

  if (result.count === 0) {
    throw new Error('Insufficient inventory');
  }

  return true;
}
```

---

## 7️⃣ NOTIFICATION SERVICE - SEND EMAIL (Event Consumer)

**File:** `services/notification-service/src/consumers/orderConsumer.ts`

```typescript
import { MessageQueue } from '../lib/messageQueue';
import { EmailService } from '../services/email.service';
import logger from '../../../../shared/logger';

interface OrderConfirmedEvent {
  orderId: number;
  userId: number;
  userEmail: string;
  items: Array<{
    productId: number;
    productName: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  shippingAddress: any;
  transactionId: string;
  confirmedAt: string;
}

export class OrderNotificationConsumer {
  constructor(
    private readonly messageQueue: MessageQueue,
    private readonly emailService: EmailService
  ) {}

  async start(): Promise<void> {
    // Listen to "order.confirmed" events and send confirmation email
    await this.messageQueue.subscribe('order.confirmed', async (event: OrderConfirmedEvent) => {
      logger.info('Received order.confirmed event', { orderId: event.orderId });

      try {
        // Generate email content
        const emailContent = this.generateOrderConfirmationEmail(event);

        // Send email
        await this.emailService.send({
          to: event.userEmail,
          subject: `Order Confirmation #${event.orderId}`,
          html: emailContent
        });

        logger.info('Order confirmation email sent', {
          orderId: event.orderId,
          email: event.userEmail
        });

      } catch (error: any) {
        logger.error('Failed to send order confirmation email', {
          orderId: event.orderId,
          error: error.message
        });
      }
    });

    logger.info('Order notification consumer started');
  }

  private generateOrderConfirmationEmail(event: OrderConfirmedEvent): string {
    const itemsHtml = event.items.map(item => `
      <tr>
        <td>${item.productName}</td>
        <td>${item.quantity}</td>
        <td>$${item.price.toFixed(2)}</td>
        <td>$${(item.quantity * item.price).toFixed(2)}</td>
      </tr>
    `).join('');

    return `
      <h1>Order Confirmation</h1>
      <p>Thank you for your order!</p>
      <h2>Order #${event.orderId}</h2>
      <table border="1">
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Price</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3"><strong>Total:</strong></td>
            <td><strong>$${event.totalAmount.toFixed(2)}</strong></td>
          </tr>
        </tfoot>
      </table>
      <p>Transaction ID: ${event.transactionId}</p>
      <p>Your order will be shipped to:</p>
      <p>${JSON.stringify(event.shippingAddress)}</p>
    `;
  }
}
```

---

## 8️⃣ DEPENDENCY INJECTION & INITIALIZATION

**File:** `services/order-service/src/server.ts`

```typescript
import express from 'express';
import { PrismaClient } from './generated/prisma-client';
import { OrderRepository } from './repositories/order.repository';
import { OrderService } from './services/order.service';
import { createOrderController } from './controllers/order.controller';
import { UserServiceClient } from './clients/userServiceClient';
import { ProductServiceClient } from './clients/productServiceClient';
import { PaymentServiceClient } from './clients/paymentServiceClient';
import { MessageQueue } from './lib/messageQueue';
import { authenticateToken } from '../../../shared/auth/middleware';

const app = express();
app.use(express.json());

// Initialize dependencies
const prisma = new PrismaClient();
const messageQueue = new MessageQueue();

// Initialize clients
const userServiceClient = new UserServiceClient();
const productServiceClient = new ProductServiceClient();
const paymentServiceClient = new PaymentServiceClient();

// Initialize repository
const orderRepository = new OrderRepository(prisma);

// Initialize service
const orderService = new OrderService(
  orderRepository,
  userServiceClient,
  productServiceClient,
  paymentServiceClient,
  messageQueue
);

// Initialize controller
const orderController = createOrderController(orderService);

// Routes
app.post('/api/orders', authenticateToken, orderController.createOrder);

// Startup
const PORT = process.env.PORT || 3003;

async function start() {
  await prisma.$connect();
  await messageQueue.connect();
  
  app.listen(PORT, () => {
    console.log(`Order Service running on port ${PORT}`);
  });
}

start();
```

---

## 🎯 SUMMARY: How It All Works Together

1. **Client** sends `POST /api/orders` with JWT token
2. **API Gateway** validates token, routes to **Order Service**
3. **Order Service** orchestrates:
   - Calls **User Service** (validate user)
   - Calls **Product Service** (check inventory)
   - Creates order in **PostgreSQL** (Order DB)
   - Publishes `order.created` event to **Message Queue**
   - Calls **Payment Service** (process payment)
   - Updates order status to "paid"
   - Publishes `order.confirmed` event to **Message Queue**
4. **Product Service** listens to `order.confirmed`, deducts inventory from **PostgreSQL** (Product DB)
5. **Notification Service** listens to `order.confirmed`, sends email to customer

**Key Architectural Patterns Used:**
- ✅ Layered Architecture (Controller → Service → Repository)
- ✅ Service-to-Service Communication (REST APIs)
- ✅ Event-Driven Architecture (Message Queue)
- ✅ Database per Service (separate PostgreSQL databases)
- ✅ Dependency Injection (constructor injection)
- ✅ Error Handling (try-catch, order cancellation on payment failure)
