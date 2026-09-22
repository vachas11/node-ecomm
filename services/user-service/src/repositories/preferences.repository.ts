import { PrismaClient } from '../generated/prisma-client';
import { UserPreferences } from '../models/UserPreferences';

export class PreferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async create(data: {
    userId: number;
    emailNotifications?: boolean;
    pushNotifications?: boolean;
    orderUpdates?: boolean;
    promotionalEmails?: boolean;
    language?: string;
    currency?: string;
    timezone?: string;
  }): Promise<UserPreferences | any> {
    const preferences = await this.prisma.userPreferences.create({
      data: {
        userId: data.userId,
        emailNotifications: data.emailNotifications ?? true,
        pushNotifications: data.pushNotifications ?? true,
        orderUpdates: data.orderUpdates ?? true,
        promotionalEmails: data.promotionalEmails ?? false,
        language: data.language ?? 'en',
        currency: data.currency ?? 'USD',
        timezone: data.timezone ?? 'UTC',
      },
    });
    return preferences;
  }

  async findByUserId(userId: number): Promise<any> {
    const preferences = await this.prisma.userPreferences.findFirst({
      where: { userId },
    });
    return preferences;
  }
  async update(
    userId: number,
    data: {
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      orderUpdates?: boolean;
      promotionalEmails?: boolean;
      language?: string;
      currency?: string;
      timezone?: string;
    }
  ): Promise<any> {
    const preferences = await this.prisma.userPreferences.update({
      where: { userId },
      data: {
        ...(data.emailNotifications !== undefined && {
          emailNotifications: data.emailNotifications,
        }),
        ...(data.pushNotifications !== undefined && { pushNotifications: data.pushNotifications }),
        ...(data.orderUpdates !== undefined && { orderUpdates: data.orderUpdates }),
        ...(data.promotionalEmails !== undefined && { promotionalEmails: data.promotionalEmails }),
        ...(data.language && { language: data.language }),
        ...(data.currency && { currency: data.currency }),
        ...(data.timezone && { timezone: data.timezone }),
      },
    });
    return preferences;
  }

  async delete(userId: number): Promise<boolean> {
    const result = await this.prisma.userPreferences.delete({
      where: { userId },
    });
    return !!result;
  }
}
