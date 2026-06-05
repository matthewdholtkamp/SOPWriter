export async function imageAssetToDataUrl(assetPath: string): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${assetPath}`);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
