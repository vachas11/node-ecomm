import { AddressRepository } from '../repositories/address.repository';
import { Address } from '../models/Address';
import { NotFoundError, ValidationError, ForbiddenError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';
import { validateAddressType, validatePhoneNumber, validatePostalCode } from '../utils/validation';

// interface for creating a new address
export interface CreateAddressData {
  userId: number;
  type: string;
  fullName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault?: boolean;
}
// interface for updating address
export interface UpdateAddressData {
  fullName: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export class AddressService {
  constructor(private readonly addressRepository: AddressRepository) {}

  //   New address creation
  async createAddress(data: CreateAddressData): Promise<Address> {
    // Validate address type
    if (!validateAddressType(data.type)) {
      logger.warn('Invalid address type attempted', { userId: data.userId, type: data.type });
      throw new ValidationError('Invalid address type. Must be "shipping" or "billing"');
    }
    // Validate phone number
    if (!validatePhoneNumber(data.phoneNumber)) {
      logger.warn('Invalid phone number format', { userId: data.userId });
      throw new ValidationError('Invalid phone number format');
    }

    // Validate postal code
    if (!validatePostalCode(data.postalCode, data.country)) {
      logger.warn('Invalid postal code for country', {
        userId: data.userId,
        country: data.country,
      });
      throw new ValidationError('Invalid postal code for the specified country');
    }
    if (data.isDefault) {
      const address = await this.addressRepository.crate({
        ...data,
        isDefault: false,
      });
      await this.addressRepository.setAsDefault(address?.id as number, data.userId, data.type);
      logger.info('Address created successfully as default', {
        addressId: address?.id as number,
        userId: data.userId,
      });
      return this.addressRepository.findById(address.id) as Promise<Address>;
    }
    const address = await this.addressRepository.crate(data);
    logger.info('Address created successfully', {
      addressId: address.id as number,
      userId: data.userId,
    });
    return address;
  }

  async getAddressById(adderssId: number, userId: number): Promise<Address> {
    const address = await this.addressRepository.findById(adderssId);
    if (!address) {
      logger.warn('Adderss Not found', { adderssId, userId });
      throw new NotFoundError('Address Not Found');
    }
    //  verify ownership
    if (address.userId !== userId) {
      logger.warn('Unauthorised address access attempt', {
        addressId: address.id,
        userId: userId,
      });
      throw new ForbiddenError("You don't have permission to access this address");
    }
    logger.debug('Address fetched successfully');
    return address;
  }
  async getDefaultAddress(userId: number, type: string): Promise<Address | null> {
    if (!validateAddressType(type)) {
      logger.warn('Invalid address type for default lookup', { userId, type });
      throw new ValidationError('Invalid address type. Must be "shipping" or "billing"');
    }
    const address = await this.addressRepository.findDefaultByUserId(userId, type);
    logger.debug('Default address lookup complete', {
      userId,
      type,
      found: !!address,
    });

    return address;
  }
  //   update address
  async updateAddress(
    addressId: number,
    userId: number,
    data: UpdateAddressData
  ): Promise<Address> {
    const isOwner = await this.addressRepository.validateOwnerShip(addressId, userId);
    if (!isOwner) {
      logger.warn('Unauthorized address update attempt', { addressId, userId });
      throw new ForbiddenError('You do not have permission to update this address');
    }
    // Validate phone number if provided
    if (data.phoneNumber && !validatePhoneNumber(data.phoneNumber)) {
      logger.warn('Invalid phone number in update', { addressId, userId });
      throw new ValidationError('Invalid phone number format');
    }
    // Validate postal code if provided
    if (data.postalCode && data.country && !validatePostalCode(data.postalCode, data.country)) {
      logger.warn('Invalid postal code in update', {
        addressId,
        userId,
        country: data.country,
      });
      throw new ValidationError('Invalid postal code for the specified country');
    }
    const updatedAddress = await this.addressRepository.update(addressId, data);
    logger.info('Address updated successfully', { addressId, userId });

    return updatedAddress;
  }
  async deleteAddress(addressId: number, userId: string): Promise<void> {
    const isOwner = await this.addressRepository.findDefaultByUserId(addressId, userId);
    if (!isOwner) {
      logger.warn('Unauthorized address deletion attempt', { addressId, userId });
      throw new ForbiddenError('You do not have permission to delete this address');
    }
    await this.addressRepository.delete(addressId);
    logger.info('Address deleted successfully', { addressId, userId });
  }

  /**
   * Set an address as default
   */
  async setDefaultAddress(addressId: number, userId: number): Promise<Address> {
    logger.info('Setting address as default', { addressId, userId });

    // Get the address to determine its type
    const address = await this.getAddressById(addressId, userId);

    // Set as default (this clears other defaults of the same type)
    await this.addressRepository.setAsDefault(addressId, userId, address.type);

    logger.info('Address set as default successfully', {
      addressId,
      userId,
      type: address.type,
    });

    // Return the updated address
    return this.addressRepository.findById(addressId) as Promise<Address>;
  }
}
