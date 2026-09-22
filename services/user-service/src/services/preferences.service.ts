import { PreferenceRepository } from '../repositories/preferences.repository';
import { UserRepository } from '../repositories/user.repository';
import { UserPreferences } from '../models/UserPreferences';
import { NotFoundError, ValidationError, ConflictError } from '../../../../shared/errors';
import logger from '../../../../shared/logger';

export interface CreatePreferencesData {
  userId: number;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  orderUpdates?: boolean;
  promotionalEmails?: boolean;
  language?: string;
  currency?: string;
  timezone?: string;
}

export interface UpdatePreferencesData {
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  orderUpdates?: boolean;
  promotionalEmails?: boolean;
  language?: string;
  currency?: string;
  timezone?: string;
}

export class PreferencesService {
  private static readonly SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'zh', 'ja'];
  private static readonly SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR'];

  constructor(
    private readonly preferenceRepository: PreferenceRepository,
    private readonly userRepository: UserRepository
  ) {}

  /**
   * Create default preferences for a new user
   * @param userId - User ID
   * @param data - Optional preference overrides
   */
  async createPreferences(userId: number, data?: CreatePreferencesData): Promise<UserPreferences> {
    logger.info('Creating user preferences', { userId });

    // Verify user exists
    const user = await this.userRepository.findById(userId);
    if (!user) {
      logger.warn('Cannot create preferences for non-existent user', { userId });
      throw new NotFoundError('User not found');
    }

    // Check if preferences already exist
    const existingPreferences = await this.preferenceRepository.findByUserId(userId);
    if (existingPreferences) {
      logger.warn('Preferences already exist for user', { userId });
      throw new ConflictError('User preferences already exist');
    }

    // Validate language if provided
    if (data?.language && !PreferencesService.SUPPORTED_LANGUAGES.includes(data.language)) {
      throw new ValidationError(
        `Unsupported language. Supported: ${PreferencesService.SUPPORTED_LANGUAGES.join(', ')}`
      );
    }

    // Validate currency if provided
    if (data?.currency && !PreferencesService.SUPPORTED_CURRENCIES.includes(data.currency)) {
      throw new ValidationError(
        `Unsupported currency. Supported: ${PreferencesService.SUPPORTED_CURRENCIES.join(', ')}`
      );
    }

    const preferences = await this.preferenceRepository.create({
      userId,
      ...data,
    });

    logger.info('User preferences created successfully', { userId });
    return UserPreferences.fromDatabase(preferences);
  }

  /**
   * Get user preferences by user ID
   * @param userId - User ID
   */
  async getPreferences(userId: number): Promise<UserPreferences> {
    logger.debug('Fetching user preferences', { userId });

    const preferences = await this.preferenceRepository.findByUserId(userId);

    if (!preferences) {
      logger.warn('Preferences not found for user', { userId });
      throw new NotFoundError('User preferences not found');
    }

    return UserPreferences.fromDatabase(preferences);
  }

  /**
   * Get user preferences or create default if not exists
   * @param userId - User ID
   */
  async getOrCreatePreferences(userId: number): Promise<UserPreferences> {
    logger.debug('Getting or creating user preferences', { userId });

    let preferences = await this.preferenceRepository.findByUserId(userId);

    if (!preferences) {
      logger.info('No preferences found, creating defaults', { userId });
      preferences = await this.preferenceRepository.create({ userId });
    }

    return UserPreferences.fromDatabase(preferences);
  }

  /**
   * Update user preferences
   * @param userId - User ID
   * @param data - Preferences to update
   */
  async updatePreferences(userId: number, data: UpdatePreferencesData): Promise<UserPreferences> {
    logger.info('Updating user preferences', { userId });

    // Check if preferences exist
    const existingPreferences = await this.preferenceRepository.findByUserId(userId);
    if (!existingPreferences) {
      logger.warn('Cannot update non-existent preferences', { userId });
      throw new NotFoundError('User preferences not found. Create preferences first.');
    }

    // Validate language if provided
    if (data.language && !PreferencesService.SUPPORTED_LANGUAGES.includes(data.language)) {
      throw new ValidationError(
        `Unsupported language. Supported: ${PreferencesService.SUPPORTED_LANGUAGES.join(', ')}`
      );
    }

    // Validate currency if provided
    if (data.currency && !PreferencesService.SUPPORTED_CURRENCIES.includes(data.currency)) {
      throw new ValidationError(
        `Unsupported currency. Supported: ${PreferencesService.SUPPORTED_CURRENCIES.join(', ')}`
      );
    }

    const updatedPreferences = await this.preferenceRepository.update(userId, data);

    logger.info('User preferences updated successfully', { userId, updates: Object.keys(data) });
    return UserPreferences.fromDatabase(updatedPreferences);
  }

  /**
   * Delete user preferences (usually during account deletion)
   * @param userId - User ID
   */
  async deletePreferences(userId: number): Promise<void> {
    logger.info('Deleting user preferences', { userId });

    const preferences = await this.preferenceRepository.findByUserId(userId);
    if (!preferences) {
      logger.warn('Cannot delete non-existent preferences', { userId });
      throw new NotFoundError('User preferences not found');
    }

    await this.preferenceRepository.delete(userId);
    logger.info('User preferences deleted successfully', { userId });
  }

  /**
   * Reset preferences to defaults
   * @param userId - User ID
   */
  async resetToDefaults(userId: number): Promise<UserPreferences> {
    logger.info('Resetting user preferences to defaults', { userId });

    const defaultData: UpdatePreferencesData = {
      emailNotifications: true,
      pushNotifications: true,
      orderUpdates: true,
      promotionalEmails: false,
      language: 'en',
      currency: 'USD',
      timezone: 'UTC',
    };

    const updatedPreferences = await this.preferenceRepository.update(userId, defaultData);

    logger.info('User preferences reset to defaults', { userId });
    return UserPreferences.fromDatabase(updatedPreferences);
  }

  /**
   * Check if user can receive promotional emails
   * @param userId - User ID
   */
  async canSendPromotionalEmail(userId: number): Promise<boolean> {
    const preferences = await this.preferenceRepository.findByUserId(userId);

    if (!preferences) {
      return false; // No preferences = no consent
    }

    const userPrefs = UserPreferences.fromDatabase(preferences);
    return !!(userPrefs.canSendEmail() && userPrefs.isPromotionalAllowed());
  }

  /**
   * Check if user can receive order update notifications
   * @param userId - User ID
   */
  async canSendOrderUpdate(userId: number): Promise<boolean> {
    const preferences = await this.preferenceRepository.findByUserId(userId);

    if (!preferences) {
      return true; // Default to true for critical notifications
    }

    const userPrefs = UserPreferences.fromDatabase(preferences);
    return !!userPrefs.canSendEmail();
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): string[] {
    return [...PreferencesService.SUPPORTED_LANGUAGES];
  }

  /**
   * Get supported currencies
   */
  getSupportedCurrencies(): string[] {
    return [...PreferencesService.SUPPORTED_CURRENCIES];
  }
}
