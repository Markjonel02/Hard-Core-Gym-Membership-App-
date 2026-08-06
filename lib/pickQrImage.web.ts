/**
 * Web counterpart to `pickQrImage.ts`.
 *
 * A transient `<input type="file">` rather than a rendered control: the browser only opens the
 * picker from inside a user gesture, and the element has to be in the document for Firefox to
 * fire `change` at all — so it is appended, clicked, and removed within the one call.
 *
 * The `blob:` URL this returns works because `scanFromURLAsync` does `fetch(url)` internally
 * (expo-camera's ExpoCameraManager.web), so no upload, no Storage bucket, and the image never
 * leaves the machine.
 */
export function pickQrImage(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';

    let settled = false;
    const finish = (uri: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(uri);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      finish(file ? URL.createObjectURL(file) : null);
    });

    // Dismissing the OS dialog fires no `change` event in most browsers. `cancel` covers the
    // ones that support it; the rest simply leave the promise pending until the next pick,
    // which is harmless — nothing is awaiting it but the button's own busy state.
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}

/** Object URLs pin the file in memory until revoked, so the caller releases it in a `finally`. */
export function releaseQrImage(uri: string): void {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
