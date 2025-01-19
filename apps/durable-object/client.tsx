import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";

import * as d3 from "d3";
import { useRef } from "react";

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socket = usePartySocket({
    party: "agent",
    room: "some-room",
    onMessage(e) {
      const data = JSON.parse(e.data);
      if (data.type === "chart") {
        renderChart(data.data, canvasRef.current!);
      }
      console.log("data", data);
    },
  });

  return (
    <div>
      <canvas ref={canvasRef} width={500} height={500}></canvas>
    </div>
  );
}

function renderChart(
  data: {
    value: number;
    label: string;
  }[],
  canvas: HTMLCanvasElement
) {
  const width = 500;
  const height = 500;
  const margin = { top: 20, right: 30, bottom: 30, left: 40 };

  const ctx = canvas.getContext("2d")!;

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.label))
    .range([margin.left, width - margin.right])
    .padding(0.1);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.value) ?? 0])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const colorPalette = [
    "#e6194B",
    "#3cb44b",
    "#ffe119",
    "#4363d8",
    "#f58231",
    "#911eb4",
    "#42d4f4",
    "#f032e6",
    "#bfef45",
    "#fabebe",
  ];

  data.forEach((d, idx) => {
    ctx.fillStyle = colorPalette[idx % colorPalette.length];
    ctx.fillRect(
      x(d.label) ?? 0,
      y(d.value),
      x.bandwidth(),
      height - margin.bottom - y(d.value)
    );
  });

  ctx.beginPath();
  ctx.strokeStyle = "black";
  ctx.moveTo(margin.left, height - margin.bottom);
  ctx.lineTo(width - margin.right, height - margin.bottom);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  x.domain().forEach((d) => {
    const xCoord = (x(d) ?? 0) + x.bandwidth() / 2;
    ctx.fillText(d, xCoord, height - margin.bottom + 6);
  });

  ctx.beginPath();
  ctx.moveTo(margin.left, height - margin.top);
  ctx.lineTo(margin.left, height - margin.bottom);
  ctx.stroke();

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks = y.ticks();
  ticks.forEach((d) => {
    const yCoord = y(d); // height - margin.bottom - y(d);
    ctx.moveTo(margin.left, yCoord);
    ctx.lineTo(margin.left - 6, yCoord);
    ctx.stroke();
    ctx.fillText(d.toString(), margin.left - 8, yCoord);
  });
  // tslab.display.png(canvas.toBuffer());
  return "Chart has been generated and displayed to the user!";
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
