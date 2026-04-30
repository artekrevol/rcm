export interface PayerScraper {
  payer_code: string;
  payer_name: string;

  list_documents(opts?: { since?: Date }): Promise<DocumentManifest[]>;
  fetch_document(url: string): Promise<FetchResult>;
  list_bulletins(opts?: { since?: Date }): Promise<BulletinManifest[]>;
}

export interface DocumentManifest {
  url: string;
  document_type: 'admin_guide' | 'supplement' | 'pa_list' | 'bulletin';
  document_name: string;
  last_modified?: Date;
  content_hash?: string;
  discovered_at: Date;
  parent_document_url?: string;
  requires_auth?: boolean;
}

export interface FetchResult {
  content: Buffer;
  mimetype: string;
  final_url: string;
  content_hash: string;
  fetched_at: Date;
  retry_after?: Date;
}

export interface BulletinManifest {
  url: string;
  title: string;
  published_at: Date;
  summary?: string;
  announces_changes_to?: string[];
}

export interface ScrapeReport {
  payer_code: string;
  started_at: Date;
  completed_at: Date;
  documents_discovered: number;
  documents_new: number;
  documents_updated: number;
  documents_unchanged: number;
  bulletins_discovered: number;
  errors: { url: string; error: string }[];
  used_fallback: boolean;
}
