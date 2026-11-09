import React, { useEffect, useState } from 'react';
import { Category } from '@gametuoitho/shared-types';
import { getCategories } from '../lib/api';

interface CategoryListProps {
  initialCategories?: Category[];
}

export default function CategoryList({ initialCategories = [] }: CategoryListProps) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);

  useEffect(() => {
    let isMounted = true;
    getCategories()
      .then((res) => {
        if (isMounted && res.success && res.data) {
          setCategories(res.data);
        }
      })
      .catch((err) => {
        console.error('Failed to load categories:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (categories.length === 0) return null;

  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-4 scrollbar-none">
      {categories.map((cat) => (
        <a
          key={cat.id}
          href={`/categories/${cat.slug}`}
          className="flex-shrink-0 px-4 py-2.5 bg-arcade-800/80 hover:bg-arcade-700/80 border border-arcade-700 hover:border-neon-cyan/60 rounded-xl transition-all text-xs font-semibold text-slate-200 hover:text-neon-cyan flex items-center gap-2 group"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan group-hover:scale-125 transition-transform" />
          <span>{cat.name}</span>
        </a>
      ))}
    </div>
  );
}
