/** A native response becomes one media source. No guessed URLs or whole-response logging. */
export function outputSource(profile, data) {
  const id = profile.upstreamModelId;
  let url, base64, mimeType;
  if (id.startsWith('bfl/')) url = data?.result?.sample;
  else if (id.startsWith('ltx/')) url = data?.result?.video_url;
  else if (id.startsWith('minimax/')) url = data?.task?.content?.url;
  else if (id.startsWith('veo/')) {
    const video = data?.response?.videos?.[0];
    base64 = video?.bytesBase64Encoded; url = video?.gcsUri; mimeType = 'video/mp4';
  } else if (id.startsWith('kling/')) url = data?.data?.task_result?.videos?.[0]?.url;
  else if (id.startsWith('wan/')) url = data?.output?.video_url;
  else if (id.startsWith('xai/') && profile.kind === 'video') url = data?.video?.url;
  else if (id.startsWith('byteplus/') && profile.kind === 'video') url = data?.content?.video_url;
  else if (id.startsWith('vertexai/')) {
    const parts = data?.candidates?.[0]?.content?.parts;
    const part = Array.isArray(parts) ? parts.find(item => item.inlineData?.mimeType?.startsWith('image/') || item.fileData?.mimeType?.startsWith('image/')) : undefined;
    base64 = part?.inlineData?.data; mimeType = part?.inlineData?.mimeType; url = part?.fileData?.fileUri;
  } else if (id.startsWith('bria/')) url = data?.result?.image_url;
  else { url = data?.data?.[0]?.url; base64 = data?.data?.[0]?.b64_json; }
  if (typeof base64 === 'string' && base64) return { base64, mimeType };
  if (typeof url === 'string' && url) return { url };
  throw Error(profile.name + ' finished without usable ' + profile.kind + ' media. Check the request in Comfy usage history.');
}
