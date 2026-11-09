import { z } from 'zod';

// Standard ApiResponse
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Auth Schemas
export const RegisterSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/, 'Chỉ chấp nhận chữ, số, gạch dưới và gạch ngang'),
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự'),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  usernameOrEmail: z.string().min(1, 'Vui lòng nhập tài khoản hoặc email'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// Game Query Schema
export const GameQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  categorySlug: z.string().optional(),
  sort: z.enum(['newest', 'popular', 'name']).default('newest'),
});
export type GameQueryInput = z.infer<typeof GameQuerySchema>;

// Admin Game Schemas
export const CreateGameSchema = z.object({
  name: z.string().min(1, 'Tên game không được để trống'),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug chỉ gồm chữ thường, số và dấu gạch ngang'),
  description: z.string().optional(),
  developer: z.string().optional(),
  publisher: z.string().optional(),
  release_year: z.number().int().min(1990).max(2030).optional(),
  category_id: z.string().min(1, 'Vui lòng chọn danh mục'),
  cover_asset_id: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN', 'ARCHIVED']).default('DRAFT'),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
});
export type CreateGameInput = z.infer<typeof CreateGameSchema>;

export const UpdateGameSchema = CreateGameSchema.partial();
export type UpdateGameInput = z.infer<typeof UpdateGameSchema>;

// Category Schemas
export const CreateCategorySchema = z.object({
  name: z.string().min(1, 'Tên danh mục không được để trống'),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  sort_order: z.number().int().default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = CreateCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

// Version Schema
export const CreateVersionSchema = z.object({
  version_name: z.string().min(1, 'Tên phiên bản không được trống'),
  jar_asset_id: z.string().min(1, 'Cần có JAR asset'),
  jad_asset_id: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
export type CreateVersionInput = z.infer<typeof CreateVersionSchema>;

// User Library Schemas
export const AddToLibrarySchema = z.object({
  game_id: z.string().min(1),
  game_version_id: z.string().optional(),
});
export type AddToLibraryInput = z.infer<typeof AddToLibrarySchema>;

export const AddImportToLibrarySchema = z.object({
  custom_name: z.string().min(1, 'Tên game không được để trống'),
  jar_asset_id: z.string().min(1, 'Cần có file JAR đã tải lên'),
  jad_asset_id: z.string().optional(),
});
export type AddImportToLibraryInput = z.infer<typeof AddImportToLibrarySchema>;

// Play History / Activity Schema
export const RecordActivitySchema = z.object({
  game_id: z.string().optional(),
  user_library_id: z.string().optional(),
  activity_type: z.enum(['PLAY', 'FAVORITE']),
});
export type RecordActivityInput = z.infer<typeof RecordActivitySchema>;
