import { DatabaseClient } from './db';
import { Category } from '@gametuoitho/shared-types';

export class CategoryRepository {
  constructor(private db: DatabaseClient) {}

  async findAll(activeOnly = true): Promise<Category[]> {
    const sql = activeOnly
      ? "SELECT * FROM categories WHERE status = 'ACTIVE' ORDER BY sort_order ASC, name ASC"
      : 'SELECT * FROM categories ORDER BY sort_order ASC, name ASC';
    return this.db.query<Category>(sql);
  }

  async findById(id: string): Promise<Category | null> {
    return this.db.queryFirst<Category>('SELECT * FROM categories WHERE id = ?', [id]);
  }

  async findBySlug(slug: string): Promise<Category | null> {
    return this.db.queryFirst<Category>('SELECT * FROM categories WHERE slug = ?', [slug]);
  }

  async create(cat: Category): Promise<void> {
    await this.db.execute(
      `INSERT INTO categories (id, name, slug, description, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cat.id, cat.name, cat.slug, cat.description, cat.sort_order, cat.status]
    );
  }

  async update(id: string, cat: Partial<Category>): Promise<void> {
    const updates: string[] = [];
    const params: any[] = [];

    if (cat.name !== undefined) {
      updates.push('name = ?');
      params.push(cat.name);
    }
    if (cat.slug !== undefined) {
      updates.push('slug = ?');
      params.push(cat.slug);
    }
    if (cat.description !== undefined) {
      updates.push('description = ?');
      params.push(cat.description);
    }
    if (cat.sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(cat.sort_order);
    }
    if (cat.status !== undefined) {
      updates.push('status = ?');
      params.push(cat.status);
    }

    if (updates.length === 0) return;
    params.push(id);

    await this.db.execute(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM categories WHERE id = ?', [id]);
  }
}
