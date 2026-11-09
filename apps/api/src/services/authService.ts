import { UserRepository } from '../repositories/userRepository';
import { RegisterInput, LoginInput } from '@gametuoitho/api-contracts';
import { hashPassword, verifyPassword, createJwt, generateId } from '@gametuoitho/shared-utils';
import { User } from '@gametuoitho/shared-types';

export class AuthService {
  constructor(private userRepo: UserRepository, private jwtSecret: string) {}

  async register(input: RegisterInput): Promise<{ user: Omit<User, 'password_hash'>; token: string }> {
    const existingUsername = await this.userRepo.findByUsername(input.username);
    if (existingUsername) {
      throw new Error('Tên đăng nhập đã tồn tại trên hệ thống');
    }

    const existingEmail = await this.userRepo.findByEmail(input.email);
    if (existingEmail) {
      throw new Error('Email này đã được sử dụng');
    }

    const hashedPassword = await hashPassword(input.password);
    const userId = generateId();

    await this.userRepo.create({
      id: userId,
      username: input.username,
      email: input.email,
      password_hash: hashedPassword,
      role: 'USER',
    });

    const user: Omit<User, 'password_hash'> = {
      id: userId,
      username: input.username,
      email: input.email,
      role: 'USER',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const token = await createJwt(
      { userId: user.id, username: user.username, role: user.role, email: user.email, tokenVersion: 0 },
      this.jwtSecret
    );

    return { user, token };
  }

  async login(input: LoginInput): Promise<{ user: Omit<User, 'password_hash'>; token: string }> {
    const user = await this.userRepo.findByUsernameOrEmail(input.usernameOrEmail);
    if (!user || !user.password_hash) {
      throw new Error('Tài khoản hoặc mật khẩu không chính xác');
    }

    if (user.status === 'BLOCKED') {
      throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên');
    }

    const passwordMatch = await verifyPassword(input.password, user.password_hash);
    if (!passwordMatch) {
      throw new Error('Tài khoản hoặc mật khẩu không chính xác');
    }

    const token = await createJwt(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        tokenVersion: user.token_version ?? 0,
      },
      this.jwtSecret
    );

    const { password_hash, ...safeUser } = user;
    return { user: safeUser, token };
  }

  async logout(userId: string): Promise<void> {
    await this.userRepo.incrementTokenVersion(userId);
  }

  async getCurrentUser(userId: string): Promise<Omit<User, 'password_hash'> | null> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  }
}
