# M19: Prisma Deep Dive - PART 2 (Relations & Joins)

**Prerequisites:** M18 (All Parts), M19-PART1  
**Level:** Intermediate  
**Time to Master:** 3-4 hours  
**Focus:** Defining and querying relational data with Prisma

---

## 📖 SECTION 1: THEORY

### What Are Relations in Prisma?

Relations define how models (tables) connect to each other. In a relational database, this is achieved through foreign keys. Prisma provides a type-safe way to define and query these relationships without writing JOIN statements.

**Real-World Analogy:**
Think of relations like family trees:
- **1-to-1**: Each person has ONE passport (User ↔ Profile)
- **1-to-many**: One parent has MANY children (User → Orders)
- **Many-to-many**: Students have MANY courses, courses have MANY students (Products ↔ Categories)

### Types of Relations

```
┌─────────────────────────────────────────────────────────────┐
│                    RELATION TYPES                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1-to-1 (One-to-One)                                        │
│  ┌──────┐           ┌─────────┐                            │
│  │ User │──────────▶│ Profile │                            │
│  └──────┘           └─────────┘                            │
│  Each user has exactly ONE profile                          │
│                                                              │
│  1-to-many (One-to-Many)                                    │
│  ┌──────┐           ┌───────┐                              │
│  │ User │──────────▶│ Order │                              │
│  └──────┘     │     └───────┘                              │
│               ├────▶│ Order │                              │
│               └────▶│ Order │                              │
│  One user has MANY orders                                   │
│                                                              │
│  many-to-many (Many-to-Many)                                │
│  ┌─────────┐   ┌──────────────┐   ┌──────────┐           │
│  │ Product │──▶│ _ProductCats │◀──│ Category │           │
│  └─────────┘   └──────────────┘   └──────────┘           │
│       ▲              (join table)         ▲                 │
│       │                                   │                 │
│       └───────────────┬───────────────────┘                │
│  Products have MANY categories, categories have MANY prods  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### When to Use Relations vs Separate Queries

**Use Relations (include/select) When:**
- You need data from both sides of the relationship
- The relationship is 1-to-1 or 1-to-few (not 1-to-thousands)
- You want type safety and autocomplete
- You need nested filtering (e.g., "users with at least 5 orders")

**Use Separate Queries When:**
- The relationship is 1-to-many with MANY (e.g., user with 10,000 orders)
- You only need the related IDs, not full objects
- You're paginating the related data
- Performance is critical and you want granular control

### The N+1 Query Problem

**❌ BAD (N+1 Problem):**
```typescript
// Fetches users
const users = await prisma.user.findMany(); // 1 query

// Then loops and fetches orders for EACH user
for (const user of users) {
  const orders = await prisma.order.findMany({
    where: { userId: user.id }  // N queries (one per user)
  });
}
// Total: 1 + N queries (if 100 users, that's 101 queries!)
```

**✅ GOOD (Prisma Solves This):**
```typescript
// Fetches users AND their orders in ONE query (with JOIN)
const users = await prisma.user.findMany({
  include: { orders: true }  // 1 query total
});
// Total: 1 query (Prisma batches the JOIN automatically)
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### Defining Relations in schema.prisma

Since our current project doesn't have Order/Product models yet, let's design them following the existing User model pattern:

#### Example Schema: E-commerce with Relations

```prisma
// services/order-service/prisma/schema.prisma

model User {
  id            Int       @id @default(autoincrement())
  email         String    @unique @map("email")
  firstName     String?   @map("first_name") @db.VarChar(100)
  lastName      String?   @map("last_name") @db.VarChar(100)
  
  // 1-to-many: One user has MANY orders
  orders        Order[]   // No @map needed (virtual field)
  
  // 1-to-1: One user has ONE profile
  profile       Profile?  // ? means optional (user might not have profile yet)
  
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@map("users")
  @@index([email])
}

model Profile {
  id            Int       @id @default(autoincrement())
  
  // Foreign key to User (1-to-1)
  userId        Int       @unique @map("user_id")  // @unique makes it 1-to-1
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  bio           String?   @db.Text
  avatarUrl     String?   @map("avatar_url") @db.VarChar(500)
  phoneNumber   String?   @map("phone_number") @db.VarChar(20)
  
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@map("profiles")
}

model Order {
  id            Int          @id @default(autoincrement())
  
  // Foreign key to User (many-to-1)
  userId        Int          @map("user_id")
  user          User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  status        String       @default("pending") @db.VarChar(20)  // pending, completed, cancelled
  totalAmount   Decimal      @map("total_amount") @db.Decimal(10, 2)
  
  // 1-to-many: One order has MANY items
  items         OrderItem[]  // Virtual field (no column in database)
  
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt @map("updated_at")

  @@map("orders")
  @@index([userId])
  @@index([status])
  @@index([createdAt])
}

model OrderItem {
  id            Int       @id @default(autoincrement())
  
  // Foreign key to Order (many-to-1)
  orderId       Int       @map("order_id")
  order         Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  
  // Foreign key to Product (many-to-1)
  productId     Int       @map("product_id")
  product       Product   @relation(fields: [productId], references: [id], onDelete: Restrict)
  
  quantity      Int       @default(1)
  priceAtTime   Decimal   @map("price_at_time") @db.Decimal(10, 2)  // Price when ordered
  
  createdAt     DateTime  @default(now()) @map("created_at")

  @@map("order_items")
  @@index([orderId])
  @@index([productId])
}

model Product {
  id            Int       @id @default(autoincrement())
  name          String    @db.VarChar(200)
  description   String?   @db.Text
  price         Decimal   @db.Decimal(10, 2)
  stock         Int       @default(0)
  isActive      Boolean   @default(true) @map("is_active")
  
  // 1-to-many: Product appears in MANY order items
  orderItems    OrderItem[]
  
  // many-to-many: Product has MANY categories, Category has MANY products
  categories    ProductCategory[]
  
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@map("products")
  @@index([name])
  @@index([isActive])
}

model Category {
  id            Int       @id @default(autoincrement())
  name          String    @unique @db.VarChar(100)
  slug          String    @unique @db.VarChar(100)
  
  // many-to-many: Category has MANY products
  products      ProductCategory[]
  
  createdAt     DateTime  @default(now()) @map("created_at")

  @@map("categories")
}

// Join table for many-to-many relation (Prisma creates this implicitly if you use @relation with arrays)
model ProductCategory {
  productId     Int       @map("product_id")
  product       Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  
  categoryId    Int       @map("category_id")
  category      Category  @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  
  assignedAt    DateTime  @default(now()) @map("assigned_at")

  @@id([productId, categoryId])  // Composite primary key
  @@map("product_categories")
}
```

#### Key Concepts in Schema

**1. @relation Directive:**
```prisma
user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
│     │     │          │        │         │           │         └─ When user deleted, cascade delete orders
│     │     │          │        │         │           └─ Column in user table to match
│     │     │          │        │         └─ Column in THIS table (foreign key)
│     │     │          └─ fields/references define FK relationship
│     │     └─ @relation directive (defines relationship)
│     └─ Type is User (references user model)
└─ Field name (how you access it in code: order.user)
```

**2. onDelete Actions:**
- `Cascade`: When parent deleted, delete children (e.g., delete user → delete their orders)
- `Restrict`: Prevent parent deletion if children exist (e.g., can't delete product if in orders)
- `SetNull`: When parent deleted, set foreign key to NULL (e.g., delete category → set product.categoryId = NULL)
- `NoAction`: Database decides (use with caution)

**3. Virtual Fields:**
```prisma
orders  Order[]  // No @map - this is VIRTUAL (not a database column)
```
This field exists in TypeScript but NOT in the database. It's Prisma's way of expressing "User has many Orders."

---

### include vs select: The Performance Difference

#### include: Fetch Related Data

```typescript
// INCLUDE: Fetches user + all their orders
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: { orders: true }  // Fetch related orders
});

// Result shape:
// {
//   id: 1,
//   email: "john@example.com",
//   firstName: "John",
//   orders: [         ← Array of order objects
//     { id: 101, status: "completed", totalAmount: 99.99, ... },
//     { id: 102, status: "pending", totalAmount: 49.99, ... }
//   ]
// }

console.log(user.orders[0].status); // "completed"
```

**Generated SQL (Prisma runs 1 query internally):**
```sql
SELECT 
  u.*, 
  o.id AS order_id, 
  o.status, 
  o.total_amount 
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.id = 1;
```

#### select: Choose Specific Fields

```typescript
// SELECT: Choose only the fields you need (reduces payload size)
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    id: true,
    email: true,
    orders: {
      select: {
        id: true,
        status: true,
        // Omit totalAmount, createdAt, etc. to reduce data transfer
      }
    }
  }
});

// Result shape (ONLY selected fields):
// {
//   id: 1,
//   email: "john@example.com",
//   orders: [
//     { id: 101, status: "completed" },
//     { id: 102, status: "pending" }
//   ]
// }

// ❌ ERROR: firstName not selected
// console.log(user.firstName);  // TypeScript error: Property 'firstName' does not exist
```

**Performance Impact:**
- `include`: All fields returned (larger payload, simpler syntax)
- `select`: Only selected fields (smaller payload, more control)
- **Rule of Thumb:** Use `select` when payload size matters (mobile apps, high traffic APIs)

#### include vs select: Cannot Mix

```typescript
// ❌ ERROR: Cannot use include and select together
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: { orders: true },  // ❌
  select: { email: true }     // ❌ - Pick ONE
});

// ✅ GOOD: Use select for everything
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    email: true,
    orders: { select: { id: true, status: true } }
  }
});
```

---

### Nested Reads: Fetching Multi-Level Relations

```typescript
// Fetch user → orders → order items → product details (3 levels deep)
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: {
    orders: {
      include: {
        items: {
          include: {
            product: true  // Fetch product details for each item
          }
        }
      }
    }
  }
});

// Result shape:
// {
//   id: 1,
//   email: "john@example.com",
//   orders: [
//     {
//       id: 101,
//       status: "completed",
//       items: [
//         { 
//           id: 1001, 
//           quantity: 2, 
//           product: { id: 50, name: "Laptop", price: 999.99 } 
//         },
//         { 
//           id: 1002, 
//           quantity: 1, 
//           product: { id: 51, name: "Mouse", price: 29.99 } 
//         }
//       ]
//     }
//   ]
// }

// Access nested data:
console.log(user.orders[0].items[0].product.name);  // "Laptop"
```

**Generated SQL:**
Prisma runs efficient JOIN queries (NOT N+1):
```sql
SELECT u.*, o.*, oi.*, p.*
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
LEFT JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN products p ON p.id = oi.product_id
WHERE u.id = 1;
```

---

### Nested Writes: Atomic Multi-Table Inserts

#### Create User with Profile in One Transaction

```typescript
// Create user AND their profile atomically (both or neither)
const user = await prisma.user.create({
  data: {
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Johnson",
    passwordHash: "hashed...",
    
    // Nested create: Create profile in same transaction
    profile: {
      create: {
        bio: "Software engineer passionate about TypeScript",
        phoneNumber: "+1-555-0123"
      }
    }
  },
  include: { profile: true }  // Return user with profile
});

// Result:
// {
//   id: 2,
//   email: "alice@example.com",
//   profile: { id: 10, bio: "Software engineer...", phoneNumber: "+1-555-0123" }
// }
```

**What Happens in the Database:**
```sql
BEGIN;
INSERT INTO users (email, first_name, ...) VALUES ('alice@example.com', 'Alice', ...);
INSERT INTO profiles (user_id, bio, phone_number) VALUES (2, 'Software engineer...', '+1-555-0123');
COMMIT;
-- If either INSERT fails, both are rolled back
```

#### Create Order with Multiple Items

```typescript
// Create order with 3 items in one transaction
const order = await prisma.order.create({
  data: {
    userId: 1,
    status: "pending",
    totalAmount: 1059.97,
    
    // Nested create: Create multiple order items
    items: {
      create: [
        { productId: 50, quantity: 1, priceAtTime: 999.99 },  // Laptop
        { productId: 51, quantity: 2, priceAtTime: 29.99 }    // Mouse x2
      ]
    }
  },
  include: {
    items: {
      include: { product: true }  // Return order with items and product details
    }
  }
});
```

#### Update with Nested Create/Update/Delete

```typescript
// Update order: Add new item, update existing item, delete another
await prisma.order.update({
  where: { id: 101 },
  data: {
    status: "completed",
    items: {
      create: [
        { productId: 52, quantity: 1, priceAtTime: 19.99 }  // Add new item
      ],
      update: [
        { where: { id: 1001 }, data: { quantity: 3 } }  // Update quantity of item 1001
      ],
      delete: [
        { id: 1002 }  // Remove item 1002
      ]
    }
  }
});
```

---

### Relation Filters: some, every, none

Relation filters allow you to query based on related data conditions.

#### some: "At Least One Related Record Matches"

```typescript
// Find users who have AT LEAST ONE completed order
const usersWithCompletedOrders = await prisma.user.findMany({
  where: {
    orders: {
      some: {  // At least one order matches this condition
        status: "completed"
      }
    }
  }
});

// SQL equivalent:
// SELECT DISTINCT u.*
// FROM users u
// INNER JOIN orders o ON o.user_id = u.id
// WHERE o.status = 'completed';
```

#### every: "All Related Records Match"

```typescript
// Find users where ALL their orders are completed (no pending/cancelled)
const usersWithAllCompletedOrders = await prisma.user.findMany({
  where: {
    orders: {
      every: {  // ALL orders must match this condition
        status: "completed"
      }
    }
  }
});

// SQL equivalent:
// SELECT u.*
// FROM users u
// WHERE NOT EXISTS (
//   SELECT 1 FROM orders o 
//   WHERE o.user_id = u.id 
//   AND o.status != 'completed'
// );
```

#### none: "No Related Records Match"

```typescript
// Find users who have NEVER placed an order
const usersWithoutOrders = await prisma.user.findMany({
  where: {
    orders: {
      none: {}  // No orders at all
    }
  }
});

// Find users with NO pending orders (only completed/cancelled)
const usersWithNoPendingOrders = await prisma.user.findMany({
  where: {
    orders: {
      none: {
        status: "pending"
      }
    }
  }
});

// SQL equivalent:
// SELECT u.*
// FROM users u
// WHERE NOT EXISTS (
//   SELECT 1 FROM orders o 
//   WHERE o.user_id = u.id 
//   AND o.status = 'pending'
// );
```

#### Combining Relation Filters

```typescript
// Find users who:
// - Have at least 5 orders
// - Have at least ONE completed order
// - Have NO cancelled orders
const eligibleUsers = await prisma.user.findMany({
  where: {
    AND: [
      {
        orders: {
          some: {
            status: "completed"  // At least one completed
          }
        }
      },
      {
        orders: {
          none: {
            status: "cancelled"  // No cancelled orders
          }
        }
      }
    ]
  },
  include: {
    _count: {
      select: { orders: true }  // Include count of orders
    }
  }
});

// Filter in application code (Prisma doesn't support "count > 5" in where)
const filtered = eligibleUsers.filter(user => user._count.orders >= 5);
```

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Relation Types Visual

```
┌─────────────────────────────────────────────────────────────────────┐
│                        1-TO-1 RELATION                               │
│                                                                      │
│  User Table                    Profile Table                        │
│  ┌────┬───────┬─────┐          ┌────┬─────────┬──────────┐         │
│  │ id │ email │ ... │          │ id │ user_id │ bio      │         │
│  ├────┼───────┼─────┤          ├────┼─────────┼──────────┤         │
│  │ 1  │ john@ │ ... │◀─────────│ 10 │ 1       │ "Dev..." │         │
│  │ 2  │ jane@ │ ... │◀─────────│ 11 │ 2       │ "PM..."  │         │
│  └────┴───────┴─────┘          └────┴─────────┴──────────┘         │
│                                       └─ UNIQUE (ensures 1-to-1)    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       1-TO-MANY RELATION                             │
│                                                                      │
│  User Table                    Order Table                          │
│  ┌────┬───────┬─────┐          ┌────┬─────────┬────────┐           │
│  │ id │ email │ ... │          │ id │ user_id │ status │           │
│  ├────┼───────┼─────┤          ├────┼─────────┼────────┤           │
│  │ 1  │ john@ │ ... │◀─────┬───│101 │ 1       │ done   │           │
│  └────┴───────┴─────┘      ├───│102 │ 1       │ pend   │           │
│                             └───│103 │ 1       │ canc   │           │
│                                 └────┴─────────┴────────┘           │
│                                       └─ NOT UNIQUE (allows many)   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      MANY-TO-MANY RELATION                           │
│                                                                      │
│  Product Table         ProductCategory (Join)      Category Table   │
│  ┌────┬──────┐         ┌────────────┬─────────────┐ ┌────┬───────┐│
│  │ id │ name │         │ product_id │ category_id │ │ id │ name  ││
│  ├────┼──────┤         ├────────────┼─────────────┤ ├────┼───────┤│
│  │ 50 │Laptop│◀────┬───│ 50         │ 1           │─┬─▶│ 1  │Tech ││
│  │ 51 │Mouse │     ├───│ 50         │ 5           │ │  │ 5  │Acc  ││
│  └────┴──────┘     │   │ 51         │ 5           │─┘  └────┴─────┘│
│                    └───│ 51         │ 1           │───┘             │
│                        └────────────┴─────────────┘                 │
│                         Composite PK (productId, categoryId)        │
└─────────────────────────────────────────────────────────────────────┘
```

### include vs select Performance

```
┌──────────────────────────────────────────────────────────────┐
│              INCLUDE VS SELECT: DATA TRANSFER                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ❌ include: { orders: true }                               │
│  ┌────────────────────────────────────────────────┐         │
│  │ User + ALL order fields (20 columns)           │         │
│  │ Payload: ~5KB per user                         │         │
│  │ Network: ████████████████████████ (5KB)        │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  ✅ select: { id, email, orders: { select: { id, status } }}│
│  ┌────────────────────────────────────────────────┐         │
│  │ User + ONLY id & status (2 columns)            │         │
│  │ Payload: ~500 bytes per user                   │         │
│  │ Network: ███ (500 bytes)                       │         │
│  └────────────────────────────────────────────────┘         │
│                                                              │
│  Impact: 10x less data transferred (mobile apps!)           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: "Find High-Value Customers"

```typescript
// Find users who have spent $500+ total across all completed orders
async findHighValueCustomers(minSpent: number) {
  // Step 1: Get users with completed orders
  const users = await this.prisma.user.findMany({
    where: {
      orders: {
        some: {
          status: "completed"
        }
      }
    },
    include: {
      orders: {
        where: { status: "completed" },
        select: { totalAmount: true }
      }
    }
  });

  // Step 2: Calculate total spent and filter in application code
  const highValue = users.filter(user => {
    const total = user.orders.reduce(
      (sum, order) => sum + order.totalAmount.toNumber(), 
      0
    );
    return total >= minSpent;
  });

  return highValue;
}
```

### Example 2: "Users Who Haven't Ordered in 30 Days"

```typescript
// Find inactive users (no orders in past 30 days)
async findInactiveUsers() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return await this.prisma.user.findMany({
    where: {
      AND: [
        {
          orders: {
            some: {}  // Has at least one order ever
          }
        },
        {
          orders: {
            none: {
              createdAt: {
                gte: thirtyDaysAgo  // No orders in last 30 days
              }
            }
          }
        }
      ]
    },
    include: {
      _count: { select: { orders: true } }
    }
  });
}
```

### Example 3: "Nested Write - Checkout Flow"

```typescript
// Complete checkout: Create order with items, decrement product stock
async checkout(userId: number, cartItems: Array<{ productId: number; quantity: number }>) {
  // Calculate total
  const products = await this.prisma.product.findMany({
    where: { id: { in: cartItems.map(item => item.productId) } }
  });

  const total = cartItems.reduce((sum, item) => {
    const product = products.find(p => p.id === item.productId);
    return sum + (product?.price.toNumber() || 0) * item.quantity;
  }, 0);

  // Create order with items in single transaction
  return await this.prisma.order.create({
    data: {
      userId,
      status: "pending",
      totalAmount: total,
      
      // Nested create: Order items
      items: {
        create: cartItems.map(item => {
          const product = products.find(p => p.id === item.productId)!;
          return {
            productId: item.productId,
            quantity: item.quantity,
            priceAtTime: product.price
          };
        })
      }
    },
    include: {
      items: {
        include: { product: true }
      }
    }
  });
  
  // Note: In production, you'd also decrement stock in this transaction
  // using $transaction([...]) - we'll cover this in M19-PART4
}
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** Explain the difference between `include` and `select` in Prisma.

**A:** 
- **include**: Fetches the base model with ALL its fields, plus related data. Simple syntax, but returns all columns.
- **select**: Explicitly choose which fields to return. More verbose but reduces payload size (important for mobile/high-traffic APIs).
- **Key Rule**: Cannot mix `include` and `select` at the same level. If you need fine-grained control, use `select` everywhere.

Example:
```typescript
// include: All user fields + all order fields (5KB)
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: { orders: true }
});

// select: Only chosen fields (500 bytes)
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    email: true,
    orders: { select: { id: true, status: true } }
  }
});
```

### 2. **Q:** How does Prisma solve the N+1 query problem?

**A:** 
The N+1 problem occurs when you fetch a list (1 query) and then loop over it to fetch related data (N queries). Prisma solves this by:

1. **Using JOIN queries automatically**: When you use `include`, Prisma generates a single SQL query with JOINs instead of separate queries.
2. **Query batching**: For nested `include` statements, Prisma intelligently batches queries to minimize round-trips.

```typescript
// ❌ N+1 (101 queries)
const users = await prisma.user.findMany();
for (const user of users) {
  const orders = await prisma.order.findMany({ where: { userId: user.id } });
}

// ✅ 1 query (Prisma uses JOIN)
const users = await prisma.user.findMany({
  include: { orders: true }
});
```

### 3. **Q:** What's the difference between `some`, `every`, and `none` relation filters?

**A:**
- **some**: "At least ONE related record matches" (SQL: EXISTS)
- **every**: "ALL related records match" (SQL: NOT EXISTS where condition is false)
- **none**: "NO related records match" (SQL: NOT EXISTS)

```typescript
// At least one completed order
where: { orders: { some: { status: "completed" } } }

// All orders are completed
where: { orders: { every: { status: "completed" } } }

// No cancelled orders
where: { orders: { none: { status: "cancelled" } } }
```

### 4. **Q:** When would you use a nested write vs separate operations?

**A:**
Use **nested writes** when:
- Operations must be atomic (all-or-nothing)
- Creating parent + children together (e.g., user + profile)
- Data integrity is critical (e.g., order + items must both succeed)

Use **separate operations** when:
- Operations can fail independently
- You need fine-grained error handling for each step
- Performance: Separate queries can be run in parallel

```typescript
// ✅ Nested write (atomic)
await prisma.user.create({
  data: {
    email: "user@example.com",
    profile: { create: { bio: "..." } }  // Both or neither
  }
});

// ✅ Separate (fine-grained control)
const user = await prisma.user.create({ data: { email: "user@example.com" } });
try {
  await prisma.profile.create({ data: { userId: user.id, bio: "..." } });
} catch (error) {
  // Handle profile creation failure separately
}
```

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Relation types (1-to-1, 1-to-many, many-to-many)
- ✅ Schema design: @relation directive, onDelete actions
- ✅ include vs select: Performance implications
- ✅ Nested reads: Multi-level relation fetching
- ✅ Nested writes: Atomic multi-table operations
- ✅ Relation filters: some, every, none
- ✅ Real-world examples: High-value customers, inactive users
- ✅ Interview questions with comprehensive answers

---

**Next:** [M19-PART3: Aggregations & Batch Operations](M19-PRISMA-DEEP-DIVE-PART3.md)  
**Previous:** [M19-PART1: Advanced Filtering & Sorting](M19-PRISMA-DEEP-DIVE-PART1.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~580 lines  
**Status:** ✅ Ready for Learning
