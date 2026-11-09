import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { SqliteDatabaseClient } from '../repositories/db';
import { bootstrapAdmin } from '../utils/bootstrapAdmin';

function findProjectRoot(): string {
  let curr = path.resolve(process.cwd());
  while (curr !== path.dirname(curr)) {
    if (
      fs.existsSync(path.join(curr, 'pnpm-workspace.yaml')) ||
      (fs.existsSync(path.join(curr, 'database')) && fs.existsSync(path.join(curr, 'apps')))
    ) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return process.cwd();
}

async function promptQuestion(query: string, hidden: boolean = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(query);
      let input = '';
      const oldRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (charBuf: Buffer) => {
        const char = charBuf.toString();
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.setRawMode(oldRaw ?? false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (char === '\u0003') { // Ctrl+C
          process.exit(1);
        } else if (char === '\b' || char === '\x7f') { // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
          }
        } else {
          input += char;
        }
      };

      process.stdin.on('data', onData);
    } else {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  const ROOT_DIR = findProjectRoot();
  const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, 'gametuoitho.sqlite');

  const args = process.argv.slice(2);
  let username = process.env.ADMIN_BOOTSTRAP_USERNAME || '';
  let email = process.env.ADMIN_BOOTSTRAP_EMAIL || '';
  let password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--username' && args[i + 1]) {
      username = args[++i];
    } else if (arg === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (arg === '--password' && args[i + 1]) {
      password = args[++i];
      console.warn('[CreateAdmin CLI] ⚠️ Cảnh báo: Việc truyền mật khẩu qua cờ lệnh --password có thể bị lưu trong lịch sử shell. Khuyến nghị nhập tương tác hoặc dùng biến môi trường ADMIN_BOOTSTRAP_PASSWORD.');
    } else if (!arg.startsWith('--')) {
      if (!username) username = arg;
      else if (!email) email = arg;
      else if (!password) {
        password = arg;
        console.warn('[CreateAdmin CLI] ⚠️ Cảnh báo: Việc truyền mật khẩu qua tham số dòng lệnh có thể bị lưu trong lịch sử shell.');
      }
    }
  }

  // Interactive prompt if missing
  if (process.stdin.isTTY) {
    if (!username) {
      username = await promptQuestion('Nhập username quản trị viên: ');
    }
    if (!email) {
      email = await promptQuestion('Nhập email quản trị viên: ');
    }
    if (!password) {
      password = await promptQuestion('Nhập mật khẩu (tối thiểu 8 ký tự, ẩn ký tự): ', true);
    }
  }

  if (!username || !email || !password) {
    console.error(`
[CreateAdmin CLI] Lỗi: Thiếu thông tin tạo tài khoản quản trị viên.

Cách sử dụng khuyến nghị:
  1. Nhập tương tác ẩn mật khẩu:
     pnpm --filter @gametuoitho/api create-admin

  2. Hoặc thiết lập qua biến môi trường:
     ADMIN_BOOTSTRAP_USERNAME=admin ADMIN_BOOTSTRAP_EMAIL=admin@domain.com ADMIN_BOOTSTRAP_PASSWORD=MatKhauManh123 pnpm --filter @gametuoitho/api create-admin
`);
    process.exit(1);
  }

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[CreateAdmin CLI] Lỗi: Không tìm thấy file database tại ${DB_PATH}. Hãy khởi chạy server lần đầu để tạo schema.`);
    process.exit(1);
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('foreign_keys = ON');
  const dbClient = new SqliteDatabaseClient(sqlite);

  const res = await bootstrapAdmin(dbClient, { username, email, password });
  if (res.success) {
    console.log(`[CreateAdmin CLI] ✓ ${res.message}`);
    process.exit(0);
  } else {
    console.error(`[CreateAdmin CLI] ✗ ${res.message}`);
    process.exit(res.code === 'ADMIN_EXISTS' ? 0 : 1);
  }
}

main().catch((err) => {
  console.error('[CreateAdmin CLI] Lỗi không lường trước:', err);
  process.exit(1);
});
