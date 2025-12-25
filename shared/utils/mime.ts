// import mimeInstance from 'mime'

// // mime 库默认导出的已经是实例，直接重新导出为命名导出
// export const mime = mimeInstance


import { Mime } from 'mime/lite';

import standardTypes from 'mime/types/standard.js';
import otherTypes from 'mime/types/other.js';


const mimeInstance = new Mime(standardTypes, otherTypes);

mimeInstance.define({ "audio/x-m4a": ["m4a"] }, true);



export const mime = mimeInstance;