import { DatabaseClient } from '../repositories/db';
import { UserRepository } from '../repositories/userRepository';
import { hashPassword, generateId } from '@gametuoitho/shared-utils';

export interface BootstrapAdminParams {
  username?: string;
  email?: string;
  password?: string;
}

export interface BootstrapAdminResult {
  success: boolean;
  code: 'SUCCESS' | 'ADMIN_EXISTS' | 'INVALID_INPUT' | 'WEAK_PASSWORD' | 'USER_EXISTS' | 'ERROR';
  message: string;
  userId?: string;
}

/**
 * Safely creates the initial administrator account (R05F-C):
 * - NEVER logs or exposes the password.
 * - Idempotent: NEVER creates an admin if any active admin already exists in the database.
 * - Enforces minimum password strength (at least 8 characters).
 */
export async function bootstrapAdmin(
  dbClient: DatabaseClient,
  params: BootstrapAdminParams
): Promise<BootstrapAdminResult> {
  const username = params.username?.trim();
  const email = params.email?.trim().toLowerCase();
  const password = params.password;

  if (!username || !email || !password) {
    return {
      success: false,
      code: 'INVALID_INPUT',
      message: 'Vui lòng cung cấp đầy đủ thông tin: username, email và password.',
    };
  }

  if (password.length < 8) {
    return {
      success: false,
      code: 'WEAK_PASSWORD',
      message: 'Mật khẩu quản trị viên phải có độ dài tối thiểu 8 ký tự.',
    };
  }

  // 1. Check if DB already contains an admin
  const existingAdmin = await dbClient.queryFirst<{ id: string; username: string }>(
    "SELECT id, username FROM users WHERE role = 'ADMIN' LIMIT 1"
  );
  if (existingAdmin) {
    return {
      success: false,
      code: 'ADMIN_EXISTS',
      message: 'Cơ sở dữ liệu đã có tài khoản quản trị viên. Bỏ qua khởi tạo.',
    };
  }

  const userRepo = new UserRepository(dbClient);

  // 2. Check if username or email is already taken
  const existingUser = await userRepo.findByUsernameOrEmail(username);
  if (existingUser) {
    return {
      success: false,
      code: 'USER_EXISTS',
      message: `Tài khoản với tên đăng nhập hoặc email "${username}" đã tồn tại.`,
    };
  }

  try {
    const passwordHash = await hashPassword(password);
    const adminId = generateId();

    await userRepo.create({
      id: adminId,
      username,
      email,
      password_hash: passwordHash,
      role: 'ADMIN',
    });

    return {
      success: true,
      code: 'SUCCESS',
      message: `Đã khởi tạo thành công quản trị viên đầu tiên: "${username}" (${email})`,
      userId: adminId,
    };
  } catch (err: any) {
    return {
      success: false,
      code: 'ERROR',
      message: err.message || 'Lỗi không xác định khi khởi tạo quản trị viên.',
    };
  }
}
