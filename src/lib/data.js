import { supabase } from './supabase.js';

// READ-ONLY data access. Only select queries and signed URLs are used.
// No insert/update/delete/upload calls exist anywhere in this app.

export async function fetchProjects() {
  const { data, error } = await supabase
    .from('mgp_projects')
    .select(
      'id,title,creator_name,status,version,bpm,musical_key,created_at,' +
        'mgp_assets(id,kind,bucket_id,object_path,file_name,mime_type,size_bytes,duration_seconds)'
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Short-lived signed URL for a private object. RLS on storage.objects decides access.
export async function signedUrl(asset, seconds = 3600) {
  if (asset._mockUrl) return asset._mockUrl();
  const { data, error } = await supabase.storage
    .from(asset.bucket_id || 'mgp-assets')
    .createSignedUrl(asset.object_path, seconds);
  if (error) throw error;
  return data.signedUrl;
}
