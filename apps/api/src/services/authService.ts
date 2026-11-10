import { UserRepository } from '../repositories/userRepository';
import { RegisterInput, LoginInput } from '@gametuoitho/api-contracts';
import { hashPassword, verifyPassword, createJwt, generateId } from '@gametuoitho/shared-utils';
import { User } from '@gametuoitho/shared-types';
import { GoogleIdentity } from './googleIdToken';

/** password_hash of accounts created with Google: not a valid "salt:hash", so password login never matches. */
export const GOOGLE_ONLY_PASSWORD_HASH = 'google-oauth-only';

function authError(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

/** Never send password hashes or the Google account id to the browser. */
function toSafeUser(user: User): Omit<User, 'password_hash'> {
  const { password_hash, google_sub, ...safeUser } = user as User & { google_sub?: string | null };
  return safeUser;
}

/** Username for a new Google account, from the email's local part (same rules as /register). */
function usernameBaseFromEmail(email: string): string {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
  return base.length >= 3 ? base : `player${base}`;
}

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

    if (user.password_hash === GOOGLE_ONLY_PASSWORD_HASH) {
      throw new Error('Tài khoản này đăng nhập bằng Google. Vui lòng bấm "Đăng nhập với Google".');
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

    return { user: toSafeUser(user), token };
  }

  /**
   * Sign in (or sign up) with a verified Google identity.
   * - Known Google account → sign in.
   * - New Google account → create a USER account (username from the email, no usable password).
   * - The email already belongs to a password account → refuse: that account was registered without
   *   email verification, so linking it automatically could hand it to whoever created it.
   */
  async loginWithGoogle(identity: GoogleIdentity): Promise<{ user: Omit<User, 'password_hash'>; token: string }> {
    let user = await this.userRepo.findByGoogleSub(identity.sub);

    if (!user) {
      const existingEmail = await this.userRepo.findByEmail(identity.email);
      if (existingEmail) {
        throw authError(
          `Email ${identity.email} đã có tài khoản đăng ký bằng mật khẩu. Vui lòng đăng nhập bằng tên đăng nhập và mật khẩu.`,
          409,
          'EMAIL_ALREADY_REGISTERED'
        );
      }

      const base = usernameBaseFromEmail(identity.email);
      let username = base;
      for (let attempt = 0; attempt < 10 && (await this.userRepo.findByUsername(username)); attempt++) {
        username = `${base.slice(0, 20)}_${Math.floor(1000 + Math.random() * 9000)}`;
      }
      if (await this.userRepo.findByUsername(username)) {
        username = `player_${generateId().replace(/-/g, '').slice(0, 10)}`;
      }

      await this.userRepo.createGoogleUser({
        id: generateId(),
        username,
        email: identity.email,
        password_hash: GOOGLE_ONLY_PASSWORD_HASH,
        google_sub: identity.sub,
      });
      user = await this.userRepo.findByGoogleSub(identity.sub);
      if (!user) throw authError('Không tạo được tài khoản. Vui lòng thử lại.', 500, 'CREATE_FAILED');
    }

    if (user.status === 'BLOCKED') {
      throw authError('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên', 403, 'ACCOUNT_BLOCKED');
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

    return { user: toSafeUser(user), token };
  }

  async logout(userId: string): Promise<void> {
    await this.userRepo.incrementTokenVersion(userId);
  }

  async getCurrentUser(userId: string): Promise<Omit<User, 'password_hash'> | null> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;
    return toSafeUser(user);
  }
}
