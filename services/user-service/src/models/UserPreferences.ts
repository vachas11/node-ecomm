export interface UserPreferencesDatabaseRow {
  id: number;
  userId: number;
  emailNotifications: boolean;
  pushNotifications: boolean;
  orderUpdates: boolean;
  promotionalEmails: boolean;
  language: string;
  currency: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export class UserPreferences {
  public readonly id: number;
  public readonly userId: number;
  public readonly emailNotifications: boolean;
  public readonly pushNotifications: boolean;
  public readonly orderUpdates: boolean;
  public readonly promotionalEmails: boolean;
  public readonly language: String;
  public readonly currency: String;
  public readonly timezone: String;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  constructor(data: UserPreferencesDatabaseRow) {
    this.id = data.id;
    this.userId = data.userId;
    this.emailNotifications = data.emailNotifications;
    this.pushNotifications = data.pushNotifications;
    this.orderUpdates = data.orderUpdates;
    this.promotionalEmails = data.promotionalEmails;
    this.language = data.language;
    this.currency = data.currency;
    this.timezone = data.timezone;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
  toJSON() {
    return {
      userId: this.userId,
      emailNotifications: this.emailNotifications,
      pushNotifications: this.pushNotifications,
      orderUpdates: this.orderUpdates,
      promotionalEmails: this.promotionalEmails,
      language: this.language,
      currency: this.currency,
      timezone: this.timezone,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromDatabase(row: UserPreferencesDatabaseRow): UserPreferences {
    return new UserPreferences(row);
  }

  static fromDatabaseArray(rows: UserPreferencesDatabaseRow[]): UserPreferences[] {
    return rows.map((row) => UserPreferences.fromDatabase(row));
  }

  //    **UserPreferences.ts** - Preferences model with methods: `canSendEmail()`,
  //  `canSendPush()`,
  // `isPromotionalAllowed()`
  canSendEmail(): Boolean {
    return this.emailNotifications;
  }
  canSendPush(): boolean {
    return this.pushNotifications;
  }
  isPromotionalAllowed(): boolean {
    return this.promotionalEmails;
  }
}
