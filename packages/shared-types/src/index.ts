export type UserRole = 'USER' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'BLOCKED';

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash?: string;
  role: UserRole;
  status: UserStatus;
  token_version?: number;
  created_at: string;
  updated_at: string;
}

export type CategoryStatus = 'ACTIVE' | 'INACTIVE';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  status: CategoryStatus;
}

export type GameStatus = 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
export type GameVisibility = 'PUBLIC' | 'PRIVATE';
export type GameSourceType = 'ADMIN' | 'USER_SUBMISSION';

export interface Game {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  developer: string | null;
  publisher: string | null;
  release_year: number | null;
  category_id: string;
  category_name?: string;
  category_slug?: string;
  cover_asset_id: string | null;
  cover_url?: string | null;
  status: GameStatus;
  visibility: GameVisibility;
  is_featured?: boolean;
  source_type: GameSourceType;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type VersionStatus = 'ACTIVE' | 'INACTIVE';

export interface GameVersion {
  id: string;
  game_id: string;
  version_name: string;
  jar_asset_id: string;
  jad_asset_id: string | null;
  jar_url?: string;
  jad_url?: string | null;
  jar_sha256: string;
  jad_sha256: string | null;
  file_size: number;
  status: VersionStatus;
  created_at: string;
}

export type AssetType = 'JAR' | 'JAD' | 'COVER' | 'SCREENSHOT';
export type AssetStatus = 'UPLOADING' | 'ACTIVE' | 'QUARANTINED' | 'DELETED';

export interface GameAsset {
  id: string;
  owner_user_id: string | null;
  asset_type: AssetType;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  status: AssetStatus;
  url?: string;
  created_at: string;
}

export type LibrarySourceType = 'CATALOG' | 'IMPORT';

export interface UserLibraryItem {
  id: string;
  user_id: string;
  game_id: string | null;
  game_version_id: string | null;
  custom_asset_id: string | null;
  custom_name: string;
  source_type: LibrarySourceType;
  created_at: string;
  game?: Game | null;
  version?: GameVersion | null;
  custom_asset?: GameAsset | null;
}

export interface GameScreenshot {
  id: string;
  game_id: string;
  asset_id: string;
  sort_order: number;
  url?: string;
}

export type ActivityType = 'PLAY' | 'FAVORITE';

export interface UserGameActivity {
  id: string;
  user_id: string;
  game_id: string | null;
  user_library_id: string | null;
  activity_type: ActivityType;
  last_played_at: string;
  play_count: number;
}

export type UploadJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface UploadJob {
  id: string;
  user_id: string;
  asset_id: string;
  status: UploadJobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

export type PhoneType = 'Standard' | 'Nokia' | 'Motorola' | 'Siemens' | 'SonyEricsson';

export interface EmulatorPlayerSettings {
  phoneType: PhoneType;
  screenSize: { width: number; height: number };
  enableSound: boolean;
  scaleMode: 'integer' | 'fractional';
}
