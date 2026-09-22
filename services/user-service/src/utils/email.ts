import nodemailer from 'nodemailer';

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send verification email to user
 * @param email - Recipient email address
 * @param token - Verification token
 */
export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`;

  const mailOptions = {
    from: process.env.SMTP_FROM || '"E-Commerce" <noreply@ecommerce.com>',
    to: email,
    subject: 'Verify Your Email Address',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Email Verification</h2>
        <p>Thank you for registering! Please verify your email address by clicking the link below:</p>
        <a href="${verificationUrl}"
           style="display: inline-block; padding: 12px 24px; background-color: #4CAF50;
                  color: white; text-decoration: none; border-radius: 4px; margin: 16px 0;">
          Verify Email
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <p style="color: #999; font-size: 12px; margin-top: 32px;">
          This link will expire in 24 hours. If you didn't create an account, please ignore this email.
        </p>
      </div>
    `,
    text: `
      Email Verification

      Thank you for registering! Please verify your email address by clicking the link below:
      ${verificationUrl}

      This link will expire in 24 hours. If you didn't create an account, please ignore this email.
    `,
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Send password reset email to user
 * @param email - Recipient email address
 * @param token - Password reset token
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const mailOptions = {
    from: process.env.SMTP_FROM || '"E-Commerce" <noreply@ecommerce.com>',
    to: email,
    subject: 'Reset Your Password',
    text: `Your password reset token: ${token}\n\nThis token expires in 15 minutes.`,
  };

  await transporter.sendMail(mailOptions);
}
