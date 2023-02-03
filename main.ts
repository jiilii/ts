import { serve } from 'https://deno.land/std@0.167.0/http/server.ts';
import { parse, stringify, validate } from 'https://jspm.dev/uuid';
import { chunk, join } from 'https://jspm.dev/lodash-es';


const userID = Deno.env.get('UUID') || '';


const handler = async (req: Request): Promise<Response> => {
  const upgrade = req.headers.get('upgrade') || '';
  if (upgrade.toLowerCase() != 'websocket') {
     return new Response(`
     <html>
      <head>
      <title>tsinghua mirror</title>
      </head>
      <body>
      <table id="list" class="table"><thead><tr><th style="width:55%">401 error<a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/?C=N&amp;O=A">File Name</a>&nbsp;<a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/?C=N&amp;O=D">&nbsp;↓&nbsp;</a></th><th style="width:20%"><a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/?C=S&amp;O=A">File Size</a>&nbsp;<a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/?C=S&amp;O=D">&nbsp;↓&nbsp;</a></th><th style="width:25%"><a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/?C=M&amp;O=A">Date</a>&nbsp;<a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/?C=M&amp;O=D">&nbsp;↓&nbsp;</a></th></tr></thead> <tbody><tr><td class="link"><a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/../">Parent directory/</a></td><td class="size">-</td><td class="date">-</td></tr> <tr><td class="link"><a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/dart-archive/" title="dart-archive">dart-archive/</a></td><td class="size">-</td><td class="date">2019-11-06 12:21</td></tr> <tr><td class="link"><a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/download.flutter.io/" title="download.flutter.io">download.flutter.io/</a></td><td class="size">-</td><td class="date">2020-04-18 22:22</td></tr> <tr><td class="link"><a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/flutter_infra/" title="flutter_infra">flutter_infra/</a></td><td class="size">-</td><td class="date">2020-03-11 15:50</td></tr> <tr><td class="link"><a href="https://mirrors.tuna.tsinghua.edu.cn/flutter/flutter_infra_release/" title="flutter_infra_release">flutter_infra_release/</a></td><td class="size">-</td><td class="date">2020-03-11 15:50</td></tr></tbody></table>
      </body>
      </html>
     `, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  }

  let isVaildUser = validate(userID);
  if (!isVaildUser) {
    console.log('not set valid UUID');
  }
  if (!isVaildUser) {
    return new Response(`error password`, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
     
  }

  const { socket, response } = Deno.upgradeWebSocket(req,{idleTimeout:0});
  let remoteConnection: Deno.TcpConn;
  let address = '';
  let port = 0;
  socket.onopen = () => console.log('socket opened');
  socket.onmessage = async (e) => {
    try {
      if (!(e.data instanceof ArrayBuffer)) {
        return;
      }
      const vlessBuffer: ArrayBuffer = e.data;

      if (remoteConnection) {
        const number = await remoteConnection.write(
          new Uint8Array(vlessBuffer)
        );
      } else {
        //https://github.com/v2ray/v2ray-core/issues/2636
        // 1 字节	  16 字节     1 字节	       M 字节	      1 字节  2 字节   1 字节	 S 字节	X 字节
        // 协议版本	  等价 UUID	  附加信息长度 M	附加信息 ProtoBuf  指令	    端口	地址类型   地址	请求数据

        // 1 字节	              1 字节	      N 字节	         Y 字节
        // 协议版本，与请求的一致	附加信息长度 N	附加信息 ProtoBuf	响应数据
        if (vlessBuffer.byteLength < 24) {
          console.log('invalid data');
          return;
        }
        const version = new Uint8Array(vlessBuffer.slice(0, 1));
        let isValidUser = false;
        if (stringify(new Uint8Array(vlessBuffer.slice(1, 17))) === userID) {
          isValidUser = true;
        }
        if (!isValidUser) {
          console.log('in valid user');
          return;
        }

        const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
        //skip opt for now

        const command = new Uint8Array(
          vlessBuffer.slice(18 + optLength, 18 + optLength + 1)
        )[0];
        // 0x01 TCP
        // 0x02 UDP
        // 0x03 MUX
        if (command === 1) {
        } else {
          console.log(
            `command ${command} is not support, command 01-tcp,02-udp,03-mux`
          );
          socket.close();
          return;
        }
        const portIndex = 18 + optLength + 1;
        const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
        // port is big-Endian in raw data etc 80 == 0x005d
        const portRemote = new DataView(portBuffer).getInt16(0);
        port = portRemote;
        let addressIndex = portIndex + 2;
        const addressBuffer = new Uint8Array(
          vlessBuffer.slice(addressIndex, addressIndex + 1)
        );

        // 1--> ipv4  addressLength =4
        // 2--> domain name addressLength=addressBuffer[1]
        // 3--> ipv6  addressLength =16
        const addressType = addressBuffer[0];
        let addressLength = 0;
        let addressValueIndex = addressIndex + 1;
        let addressValue = '';
        switch (addressType) {
          case 1:
            addressLength = 4;
            addressValue = new Uint8Array(
              vlessBuffer.slice(
                addressValueIndex,
                addressValueIndex + addressLength
              )
            ).join('.');
            break;
          case 2:
            addressLength = new Uint8Array(
              vlessBuffer.slice(addressValueIndex, addressValueIndex + 1)
            )[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(
              vlessBuffer.slice(
                addressValueIndex,
                addressValueIndex + addressLength
              )
            );
            break;
          case 3:
            addressLength = 16;
            const addressChunkBy2: number[][] = chunk(
              new Uint8Array(
                vlessBuffer.slice(
                  addressValueIndex,
                  addressValueIndex + addressLength
                )
              ),
              2,
              null
            );
            // 2001:0db8:85a3:0000:0000:8a2e:0370:7334
            addressValue = addressChunkBy2
              .map((items) =>
                items.map((item) => item.toString(16).padStart(2, '0')).join('')
              )
              .join('.');
            break;
          default:
            console.log(`[${address}:${port}] invild address`);
        }
        address = addressValue;
        if (!addressValue) {
          console.log(`[${address}:${port}] addressValue is empty`);
          socket.close();
          return;
        }
        // const addressType = requestAddr >> 4;
        // const addressLength = requestAddr & 0x0f;
//         console.log(`[${address}:${port}] connecting`);
        remoteConnection = await Deno.connect({
          port: port,
          hostname: addressValue,
        });

        const rawDataIndex = addressValueIndex + addressLength;
        const rawClientData = vlessBuffer.slice(rawDataIndex);
        await remoteConnection.write(new Uint8Array(rawClientData));

        let chunkDatas = [new Uint8Array( [version[0], 0])];
        remoteConnection.readable
          .pipeTo(
            new WritableStream({
              start() {
                socket.send(new Blob(chunkDatas));
              },
              async write(chunk) {
                await new Promise((res, rej) => {
                    setTimeout(res, 2);
                  });
                socket.send(new Blob([chunk]));
              },
              close() {
                socket.close();
                console.log('writable stream close')
              }
            })
          )
          .catch((error) => {
            socket.close();
            console.log(
              `[${address}:${port}] remoteConnection pipe to has error`,
              error
            );
          });
      }
    } catch (error) {
      // console.log(
      //   [...new Uint8Array(vlessBuffer.slice(0, 32))].map((x) =>
      //     x.toString(16).padStart(2, '0')
      //   )
      // );
      socket.close();
      console.log(`[${address}:${port}] request hadler has error`, error);
    }
  };
  socket.onerror = (e) =>
    console.log(`[${address}:${port}] socket errored:`, e);
  socket.onclose = () => console.log(`[${address}:${port}] socket closed`);
  return response;
};

serve(handler, { port: 8080, hostname: '0.0.0.0' });
