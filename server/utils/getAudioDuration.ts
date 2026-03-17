import { parseWebStream } from 'music-metadata';


/**
 * 使用 fetch 和 music-metadata 获取远程音频时长
 * @param {string} url 音频地址
 */
export async function getAudioDuration(url: string): Promise<number | undefined> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  // 获取必要的 Header 信息辅助解析（可选但推荐）
  const options = {
    mimeType: response.headers.get('content-type') as string,
    size: response.headers.get('content-length') as string
      ? parseInt(response.headers.get('content-length') as string)
      : undefined
  };

  try {
    // parseWebStream 直接接收 fetch 的 response.body
    const metadata = await parseWebStream(response.body as any, options as any);

    // 成功获取元数据后，主动取消流以节省带宽
    // 这会触发底层的 TCP 连接关闭，停止下载剩余的音频数据
    if (response.body && !response.body.locked) {
      await response.body.cancel();
    }

    return metadata.format.duration;
  } catch (error: any) {
    // 确保出错时也尝试关闭流
    if (response.body && !response.body.locked) {
      await response.body.cancel();
    }
    console.error('解析元数据失败:', error.message);
    throw error;
  }
}

// // 使用示例 (Top-level await)
// try {
//   const audioUrl = 'https://example.com/audio.mp3';
//   const duration = await getAudioDuration(audioUrl);
//   console.log(`时长: ${duration.toFixed(2)} 秒`);
// } catch (err) {
//   console.error('执行出错:', err);
// }