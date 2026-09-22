/**
 * Address Domain Model
 * Rich domain model with business logic
 */

export interface AddressDatabaseRow {
  id: number;
  user_id: number;
  type: string;
  full_name: string;
  phone_number: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export class Address {
  public readonly id: number;
  public readonly userId: number;
  public readonly type: string;
  public readonly fullName: string;
  public readonly phoneNumber: string;
  public readonly addressLine1: string;
  public readonly addressLine2: string | null;
  public readonly city: string;
  public readonly state: string;
  public readonly postalCode: string;
  public readonly country: string;
  public readonly isDefault: boolean;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(data: AddressDatabaseRow) {
    this.id = data.id;
    this.userId = data.user_id;
    this.type = data.type;
    this.fullName = data.full_name;
    this.phoneNumber = data.phone_number;
    this.addressLine1 = data.address_line1;
    this.addressLine2 = data.address_line2;
    this.city = data.city;
    this.state = data.state;
    this.postalCode = data.postal_code;
    this.country = data.country;
    this.isDefault = data.is_default;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /**
   * Create Address from database row (snake_case -> camelCase)
   */
  static fromDatabase(row: AddressDatabaseRow): Address {
    return new Address(row);
  }

  /**
   * Create Address from Prisma result (already camelCase)
   */
  static fromPrisma(data: {
    id: number;
    userId: number;
    type: string;
    fullName: string;
    phoneNumber: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Address {
    return new Address({
      id: data.id,
      user_id: data.userId,
      type: data.type,
      full_name: data.fullName,
      phone_number: data.phoneNumber,
      address_line1: data.addressLine1,
      address_line2: data.addressLine2,
      city: data.city,
      state: data.state,
      postal_code: data.postalCode,
      country: data.country,
      is_default: data.isDefault,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    });
  }

  /**
   * Create multiple Address instances from database rows
   */
  static fromDatabaseArray(rows: any[]): Address[] {
    return rows.map((row) => Address.fromPrisma(row));
  }

  /**
   * Business logic: Check if this is a shipping address
   */
  isShippingAddress(): boolean {
    return this.type.toLowerCase() === 'shipping';
  }

  /**
   * Business logic: Check if this is a billing address
   */
  isBillingAddress(): boolean {
    return this.type.toLowerCase() === 'billing';
  }

  /**
   * Get full formatted address as string
   */
  getFullAddress(): string {
    const parts = [
      this.addressLine1,
      this.addressLine2,
      `${this.city}, ${this.state} ${this.postalCode}`,
      this.country,
    ];
    return parts.filter(Boolean).join('\n');
  }

  /**
   * Serialize to JSON for API responses
   */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      type: this.type,
      fullName: this.fullName,
      phoneNumber: this.phoneNumber,
      addressLine1: this.addressLine1,
      addressLine2: this.addressLine2,
      city: this.city,
      state: this.state,
      postalCode: this.postalCode,
      country: this.country,
      isDefault: this.isDefault,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
