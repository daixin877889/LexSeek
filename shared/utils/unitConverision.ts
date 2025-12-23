/**
 * 单位转换工具
 */
import { TimeUnit, FileSizeUnit, CountUnit } from "../types/unitConverision";

/**
 * 时间单位转换进制
 */
export function timeUnitToMs(inputValue: number, inputUnit: TimeUnit, outputUnit?: TimeUnit): number {
  // 如果输出单位为空，则默认输出毫秒
  outputUnit = outputUnit || TimeUnit.MILLISECOND;
  //  定义转换单位
  const unitMap = {
    [TimeUnit.MILLISECOND]: 1,
    [TimeUnit.SECOND]: 1000,
    [TimeUnit.MINUTE]: 60000,
    [TimeUnit.HOUR]: 3600000,
    [TimeUnit.DAY]: 86400000,
    [TimeUnit.MONTH]: 259200000,
  }
  // 先转换成毫秒
  const ms = inputValue * unitMap[inputUnit];
  // 再转换成输出单位
  const outputValue = ms / unitMap[outputUnit];
  return outputValue;
}

/**
* 文件大小单位转换进制
*/
export function fileSizeUnitToBytes(inputValue: number, inputUnit: FileSizeUnit, outputUnit?: FileSizeUnit): number {
  // 如果输出单位为空，则默认输出字节
  outputUnit = outputUnit || FileSizeUnit.BYTE;
  // 定义转换单位
  const unitMap = {
    [FileSizeUnit.BYTE]: 1,
    [FileSizeUnit.KB]: 1024,
    [FileSizeUnit.MB]: 1024 * 1024,
    [FileSizeUnit.GB]: 1024 * 1024 * 1024,
    [FileSizeUnit.TB]: 1024 * 1024 * 1024 * 1024,
  }
  // 先转换成字节
  const bytes = inputValue * unitMap[inputUnit];
  // 再转换成输出单位
  const outputValue = bytes / unitMap[outputUnit];
  return outputValue;
}
/**
* 格式化字节大小为易读的形式
* @param bytes 字节数
* @returns 格式化后的大小
*/
export const formatByteSize = (bytes: number | null | undefined, toFixed?: number): string => {
  // 处理无效值
  if (bytes === null || bytes === undefined || isNaN(bytes)) {
    return '0 Bytes';
  }
  let value = 0;
  let unit = "Bytes"

  if (bytes >= 1024 * 1024 * 1024 * 1024) {
    value = fileSizeUnitToBytes(bytes, FileSizeUnit.BYTE, FileSizeUnit.TB)
    unit = "TB"
  } else if (bytes >= 1024 * 1024 * 1024) {
    value = fileSizeUnitToBytes(bytes, FileSizeUnit.BYTE, FileSizeUnit.GB)
    unit = "GB"
  } else if (bytes >= 1024 * 1024) {
    value = fileSizeUnitToBytes(bytes, FileSizeUnit.BYTE, FileSizeUnit.MB)
    unit = "MB"
  } else if (bytes >= 1024) {
    value = fileSizeUnitToBytes(bytes, FileSizeUnit.BYTE, FileSizeUnit.KB)
    unit = "KB"
  } else {
    value = bytes
    unit = "Bytes"
  }
  if (toFixed) {
    value = Number(value.toFixed(toFixed))
  }
  return `${value} ${unit}`;
}

/**
* 次数单位转换进制
*/
export function countUnitToCount(inputValue: number, inputUnit: CountUnit, outputUnit?: CountUnit): number {
  // 如果输出单位为空，则默认输出次
  outputUnit = outputUnit || CountUnit.COUNT;
  // 定义转换单位
  const unitMap = {
    [CountUnit.COUNT]: 1,
  }
  // 先转换成次
  const count = inputValue * unitMap[inputUnit];
  // 再转换成输出单位
  const outputValue = count / unitMap[outputUnit];
  return outputValue;
}

