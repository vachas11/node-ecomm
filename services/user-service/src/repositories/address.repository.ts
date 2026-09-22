import { PrismaClient } from '../generated/prisma-client';
import { Address } from '../models/Address';

export interface CreateAddressInput {
  userId: number;
  type: string;
  fullName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault?: boolean;
}

export interface updateAddressInput {
  type?: string;
  fullName?: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  isDefault?: boolean;
}

export class AddressRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async crate(data: CreateAddressInput): Promise<Address> {
    const address = await this.prisma.address.create({
      data: {
        userId: data.userId,
        type: data.type,
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 || null,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
        isDefault: data.isDefault || false,
      },
    });
    return address ? Address.fromPrisma(address) : null;
  }
  async findById(id: number): Promise<Address | null> {
    const address = await this.prisma.address.findUnique({
      where: { id },
    });
    return address ? Address.fromPrisma(address) : null;
  }
  async findByUserId(userId: number) {
    const address = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return Address.fromDatabaseArray(address);
  }
  async findDefaultByUserId(userId: number, type: string): Promise<Address | null> {
    const address = await this.prisma.address.findFirst({
      where: { userId, type, isDefault: true },
    });
    return address ? Address.fromPrisma(address) : null;
  }
  async update(
    id: number,
    data: {
      fullName?: string;
      phoneNumber?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    }
  ): Promise<Address> {
    const address = await this.prisma.address.update({
      where: { id },
      data: {
        ...(data.fullName && { fullName: data.fullName }),
        ...(data.phoneNumber && { phoneNumber: data.phoneNumber }),
        ...(data.addressLine1 && { addressLine1: data.addressLine1 }),
        ...(data.addressLine2 !== undefined && { addressLine2: data.addressLine2 || null }),
        ...(data.city && { city: data.city }),
        ...(data.state && { state: data.state }),
        ...(data.postalCode && { postalCode: data.postalCode }),
        ...(data.country && { country: data.country }),
      },
    });
    return Address.fromPrisma(address);
  }
  async delete(id: number): Promise<boolean> {
    const result = await this.prisma.address.delete({
      where: { id },
    });
    return !!result;
  }
  async setAsDefault(id: number, userId: number, type: string): Promise<void> {
    // clear all other default for this user
    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: {
          userId,
          type,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      }),
      this.prisma.address.update({
        where: { id },
        data: {
          isDefault: true,
        },
      }),
    ]);
  }
  async validateOwnerShip(addressId: number, userId: number): Promise<Boolean> {
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });
    return !!address;
  }

  // private toDatabaseRow(address: any): AddressDatabaseRow {
  //   return {
  //     id: address.id,
  //     user_id: address.userId,
  //     type: address.type,
  //     full_name: address.fullName,
  //     phone_number: address.phoneNumber,
  //     address_line1: address.addressLine1,
  //     address_line2: address.addressLine2,
  //     city: address.city,
  //     state: address.state,
  //     postal_code: address.postalCode,
  //     country: address.country,
  //     is_default: address.isDefault,
  //     created_at: address.createdAt,
  //     updated_at: address.updatedAt,
  //   };
  // }
}
