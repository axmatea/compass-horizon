import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export const ASSET_LIMITS=Object.freeze({fileBytes:512*1024,activeFiles:8,applicationBytes:4*1024*1024,ownerBytes:16*1024*1024,pixels:5000000,dimension:8192});
const fail=code=>{throw Object.assign(new Error(code),{status:415,code})};
const CRC=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^n>>>1:n>>>1;return n>>>0});
export function imageCrc32(data){let crc=0xffffffff;for(const byte of data)crc=CRC[(crc^byte)&255]^crc>>>8;return(crc^0xffffffff)>>>0}
function dimensions(width,height){if(!width||!height||width>ASSET_LIMITS.dimension||height>ASSET_LIMITS.dimension||width*height>ASSET_LIMITS.pixels)fail('image_dimensions_exceeded')}
function png(input){
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);if(!input.subarray(0,8).equals(signature))fail('invalid_image');
  let at=8,width,height,depth,color,interlace,seenData=false,endedData=false,palette=0,transparency=false;const keep=[signature],compressed=[];
  while(at<input.length){
    if(at+12>input.length)fail('invalid_image');const length=input.readUInt32BE(at),end=at+12+length;if(end>input.length)fail('invalid_image');
    const type=input.toString('ascii',at+4,at+8),data=input.subarray(at+8,at+8+length);
    if(!/^[A-Za-z]{4}$/.test(type)||type[2]!==type[2].toUpperCase()||imageCrc32(input.subarray(at+4,end-4))!==input.readUInt32BE(end-4))fail('invalid_image');
    if(width===undefined&&type!=='IHDR')fail('invalid_image');
    if(type==='IHDR'){
      if(width!==undefined||length!==13)fail('invalid_image');width=data.readUInt32BE(0);height=data.readUInt32BE(4);dimensions(width,height);depth=data[8];color=data[9];interlace=data[12];
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!depths[color]?.includes(depth)||data[10]!==0||data[11]!==0||![0,1].includes(interlace))fail('invalid_image');
    }else if(type==='PLTE'){
      if(seenData||palette||!length||length%3||length>768||[0,4].includes(color))fail('invalid_image');palette=length/3;if(color===3&&palette>2**depth)fail('invalid_image');
    }else if(type==='tRNS'){
      if(seenData||transparency||![0,2,3].includes(color)||(color===0&&length!==2)||(color===2&&length!==6)||(color===3&&(!palette||length>palette||!length)))fail('invalid_image');transparency=true;
    }else if(type==='IDAT'){
      if(endedData||color===3&&!palette)fail('invalid_image');seenData=true;compressed.push(data);
    }else if(type==='IEND'){
      if(length||!seenData||end!==input.length)fail('invalid_image');keep.push(input.subarray(at,end));at=end;break;
    }else{
      if(!(type.charCodeAt(0)&32)||['acTL','fcTL','fdAT'].includes(type))fail('image_encoding_unsupported');
      if(seenData)endedData=true;
    }
    // Drop metadata/profiles; retain only image-critical chunks and alpha.
    if(['IHDR','PLTE','tRNS','IDAT'].includes(type))keep.push(input.subarray(at,end));at=end;
  }
  if(at!==input.length||keep.at(-1)?.toString('ascii',4,8)!=='IEND')fail('invalid_image');
  const channels={0:1,2:3,3:1,4:2,6:4}[color],passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]],rows=[];
  let expected=0;
  for(const[x,y,dx,dy]of passes){const w=Math.ceil(Math.max(0,width-x)/dx),h=Math.ceil(Math.max(0,height-y)/dy);if(w&&h){const stride=Math.ceil(w*channels*depth/8)+1;rows.push([stride,h]);expected+=stride*h}}
  let decoded;try{decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1})}catch{fail('invalid_image')}
  if(decoded.length!==expected)fail('invalid_image');let offset=0;for(const[stride,height]of rows)for(let row=0;row<height;row++){if(decoded[offset]>4)fail('invalid_image');offset+=stride}
  return{data:Buffer.concat(keep),width,height};
}
function jpeg(input){
  if(input.length<4||input[0]!==255||input[1]!==216)fail('invalid_image');let at=2,width,height,components,scans=0;const keep=[input.subarray(0,2)];
  while(at<input.length){
    const start=at;if(input[at++]!==255)fail('invalid_image');while(input[at]===255)at++;const marker=input[at++];
    if(marker===217){if(!scans||at!==input.length)fail('invalid_image');keep.push(input.subarray(start,at));return{data:Buffer.concat(keep),width,height}}
    if(!marker||marker===216||marker===1||marker>=208&&marker<=215||at+2>input.length)fail('invalid_image');
    const length=input.readUInt16BE(at),end=at+length;if(length<2||end>input.length)fail('invalid_image');const payload=at+2;
    if([192,193,194].includes(marker)){
      if(width!==undefined||length<11||input[payload]!==8)fail('invalid_image');height=input.readUInt16BE(payload+1);width=input.readUInt16BE(payload+3);dimensions(width,height);components=input[payload+5];if(![1,3,4].includes(components)||length!==8+3*components)fail('invalid_image');
    }else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))fail('image_encoding_unsupported');
    if(marker===218){
      if(width===undefined||length<8||input[payload]<1||input[payload]>components||length!==6+2*input[payload])fail('invalid_image');scans++;let next=end,content=false;
      while(next<input.length){if(input[next]!==255){content=true;next++;continue}let following=next+1;while(input[following]===255)following++;const code=input[following];if(code===0||code>=208&&code<=215){content=true;next=following+1;continue}break}
      if(!content||next>=input.length)fail('invalid_image');keep.push(input.subarray(start,next));at=next;continue;
    }
    // APP/EXIF/XMP/ICC and comments are metadata, never needed in the payload.
    if(!(marker>=224&&marker<=239)&&marker!==254)keep.push(input.subarray(start,end));at=end;
  }fail('invalid_image');
}
export function inspectImage(value,mime){
  if(!Buffer.isBuffer(value)&&!(value instanceof Uint8Array))fail('invalid_image');const input=Buffer.from(value);
  if(!input.length||input.length>ASSET_LIMITS.fileBytes)throw Object.assign(new Error('asset_file_too_large'),{status:413,code:'asset_file_too_large'});
  if(!['image/png','image/jpeg'].includes(mime))fail('image_type_unsupported');
  const image=mime==='image/png'?png(input):jpeg(input);
  return{...image,mime,bytes:image.data.length,sha256:createHash('sha256').update(image.data).digest('hex')};
}
export const assetFilename=asset=>'public/assets/'+asset.id+(asset.mime==='image/png'?'.png':'.jpg');
