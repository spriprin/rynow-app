-- Supabase Storage delete resolves the object through SELECT before applying
-- DELETE. Keep the owner able to select every object in their own folder so the
-- client can remove a replaced avatar after the profile row switches paths.
-- Non-owners still pass through the current-avatar helper and cannot create new
-- signed URLs for a replaced path.

alter policy avatars_read_owner_or_shared_room on storage.objects
using (
  bucket_id = 'avatars'
  and (
    (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and owner_id = (select auth.uid())::text
    )
    or public.can_current_user_read_current_avatar(
      public.safe_uuid((storage.foldername(name))[1]),
      name
    )
  )
);
