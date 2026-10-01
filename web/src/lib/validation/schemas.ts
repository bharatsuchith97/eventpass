import { z } from 'zod';
import { GUEST_CATEGORIES } from '../../types';

export const passwordField = z
  .string()
  .min(10, 'Use at least 10 characters')
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'Include letters and at least one number');

export const loginSchema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });
export const registerSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter your company name'),
  fullName: z.string().trim().min(1, 'Enter your name'),
  email: z.string().email('Enter a valid email'),
  password: passwordField,
});
export const forgotSchema = z.object({ email: z.string().email('Enter a valid email') });
export const resetSchema = z.object({ newPassword: passwordField });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordField });

export const eventSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter an event name').max(150),
    description: z.string().max(5000),
    venueName: z.string().max(150),
    venueAddress: z.string().max(300),
    startDatetime: z.string().min(1, 'Pick a start time'),
    endDatetime: z.string().min(1, 'Pick an end time'),
    capacity: z.string().regex(/^\d*$/, 'Whole number only'),
    bannerUrl: z.string().refine((v) => v === '' || v.startsWith('https://'), 'Must be an https:// link'),
  })
  .refine((d) => !d.startDatetime || !d.endDatetime || new Date(d.endDatetime) > new Date(d.startDatetime), {
    message: 'End must be after start',
    path: ['endDatetime'],
  });
export type EventFormValues = z.infer<typeof eventSchema>;

export const guestSchema = z.object({
  externalId: z.string().trim().max(50, 'Use at most 50 characters').refine((v) => v === '' || /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v), 'Use letters, numbers, - _ / or .'),
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().refine((v) => v.trim() === '' || /^\+?\d{6,15}$/.test(v.replace(/[\s().-]/g, '')), 'Invalid phone number'),
  companyName: z.string().max(150),
  category: z.enum(GUEST_CATEGORIES as [string, ...string[]]),
  notes: z.string().max(2000),
});
export type GuestFormValues = z.infer<typeof guestSchema>;

export const userSchema = z.object({
  fullName: z.string().trim().min(1, 'Required'),
  email: z.string().email('Enter a valid email'),
  role: z.enum(['COMPANY_ADMIN', 'EVENT_MANAGER', 'CHECKIN_STAFF']),
  password: passwordField,
});

export const settingsSchema = z.object({
  companyName: z.string().trim().min(2, 'Required'),
  primaryBrandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #1565c0'),
  timezone: z.string().min(1),
  defaultLanguage: z.string().regex(/^[a-z]{2}$/, 'Two-letter code, e.g. en'),
  contactEmail: z.string().refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email'),
  contactPhone: z.string().max(40),
});
export type SettingsFormValues = z.infer<typeof settingsSchema>;
