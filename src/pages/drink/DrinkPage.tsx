import '../../styles/drink.css';

import { useEffect, useRef, useState } from 'react';

/* ============================================================
   음주 카메라 — 주소로 바로 들어와 쓴다.
   카메라 화면을 왜곡해서 보여 주기만 하고 녹화 · 전송은 하지 않는다.
   ============================================================ */

const RAMP_SECONDS = 2;   // 정상 화면에서 울렁임이 다 커질 때까지 걸리는 시간
const AMOUNT = 0.42;      // 이후 끝까지 유지하는 울렁임 세기 (1이 가장 심함)

const VERTEX = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() { uv = pos * .5 + .5; gl_Position = vec4(pos, 0., 1.); }`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D frame;
uniform float t;
uniform float amount;

void main() {
  // 몸이 흔들리는 듯한 느린 기울임과 이동. 가장자리가 보이지 않게 살짝 확대한다
  float tilt = sin(t * .55) * .07 * amount;
  vec2 p = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * (uv - .5);
  p *= 1. - .12 * amount + sin(t * .4) * .02 * amount;
  p += vec2(sin(t * .7), cos(t * .5)) * .03 * amount + .5;
  p.x = 1. - p.x;   // 거울처럼 보이게

  // 화면이 출렁이는 물결
  vec2 wave = vec2(sin(p.y * 8. + t * 1.9), cos(p.x * 7. + t * 1.5)) * .02 * amount;
  wave += vec2(sin(p.y * 17. - t * 1.1), cos(p.x * 15. + t * .8)) * .007 * amount;
  vec2 q = p + wave;

  // 초점이 벌어졌다 모였다 하며 두 겹으로 보인다
  float split = (.012 + .016 * (.5 + .5 * sin(t * .8))) * amount;
  vec2 ghost = vec2(split, split * .35);
  vec3 c = texture(frame, q).rgb * (1. - .62 * amount)
         + (texture(frame, q + ghost).rgb + texture(frame, q - ghost).rgb) * .31 * amount;

  // 색이 번지고 가장자리가 어두워진다
  vec2 fringe = vec2(.008 * amount, 0.);
  c.r = mix(c.r, texture(frame, q + fringe).r, .5);
  c.b = mix(c.b, texture(frame, q - fringe).b, .5);
  c *= mix(1., .55 + .45 * smoothstep(.85, .25, length(uv - .5)), amount);
  color = vec4(c, 1.);
}`;

function createShader(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, 'pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return { gl, time: gl.getUniformLocation(program, 't'), amount: gl.getUniformLocation(program, 'amount') };
}

function cameraError(e: unknown) {
  const { name } = e as Error;
  if (name === 'NotAllowedError') return '주소창의 카메라 권한을 허용하고 새로고침해 주세요.';
  if (name === 'NotFoundError') return '카메라를 찾을 수 없습니다.';
  return '카메라를 켤 수 없습니다.';
}

export default function DrinkPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const shader = createShader(canvas);
    if (!shader) {
      setError('이 브라우저에서는 카메라 효과를 쓸 수 없습니다.');
      return;
    }
    const { gl, time, amount } = shader;
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    let stream: MediaStream | undefined;
    let frame = 0;
    let startedAt = 0;
    let closed = false;

    function draw(now: number) {
      frame = requestAnimationFrame(draw);
      if (video.readyState < 2) return;
      startedAt ||= now;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      const seconds = (now - startedAt) / 1000;
      gl.uniform1f(time, seconds);
      gl.uniform1f(amount, AMOUNT * Math.min(1, seconds / RAMP_SECONDS));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(async s => {
        if (closed) {
          s.getTracks().forEach(track => track.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        await video.play();
        frame = requestAnimationFrame(draw);
      })
      .catch(e => setError(cameraError(e)));

    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  return (
    <main className="drink">
      <canvas ref={canvasRef} />
      {error && <p className="drink__error">{error}</p>}
    </main>
  );
}
