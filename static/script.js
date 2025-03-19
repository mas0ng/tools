const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');

// Global state
const objects = [];         // Stores drawn objects (strokes and text)
const redoStack = [];       // For redo functionality
let currentMode = 'pen';    // Modes: 'pen', 'highlighter', 'eraser', 'line', 'text', 'move'
let isDrawing = false;
let currentStroke = null;
let currentLine = null;     // For the line tool
let selectedObject = null;
let moveOffset = { dx: 0, dy: 0 };

// High DPI canvas resizing for smoother drawing
function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Toolbar elements
const penBtn = document.getElementById('penBtn');
const highlighterBtn = document.getElementById('highlighterBtn');
const eraserBtn = document.getElementById('eraserBtn');
const lineBtn = document.getElementById('lineBtn');
const textBtn = document.getElementById('textBtn');
const moveBtn = document.getElementById('moveBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const colorPicker = document.getElementById('colorPicker');
const brushSize = document.getElementById('brushSize');

// Set active button styling
function setActiveButton(button) {
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  button.classList.add('active');
}

penBtn.addEventListener('click', () => { currentMode = 'pen'; setActiveButton(penBtn); });
highlighterBtn.addEventListener('click', () => { currentMode = 'highlighter'; setActiveButton(highlighterBtn); });
eraserBtn.addEventListener('click', () => { currentMode = 'eraser'; setActiveButton(eraserBtn); });
lineBtn.addEventListener('click', () => { currentMode = 'line'; setActiveButton(lineBtn); });
textBtn.addEventListener('click', () => { currentMode = 'text'; setActiveButton(textBtn); });
moveBtn.addEventListener('click', () => { currentMode = 'move'; setActiveButton(moveBtn); });

undoBtn.addEventListener('click', () => {
  if (objects.length > 0) {
    redoStack.push(objects.pop());
    redraw();
  }
});
redoBtn.addEventListener('click', () => {
  if (redoStack.length > 0) {
    objects.push(redoStack.pop());
    redraw();
  }
});
clearBtn.addEventListener('click', () => {
  if (confirm("Are you sure you want to clear the canvas?")) {
    objects.length = 0;
    redoStack.length = 0;
    redraw();
  }
});
saveBtn.addEventListener('click', () => {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.fillStyle = '#ffffff';
  tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCtx.drawImage(canvas, 0, 0);
  const dataURL = tempCanvas.toDataURL("image/jpeg", 0.92);
  const link = document.createElement("a");
  link.download = "drawing.jpg";
  link.href = dataURL;
  link.click();
});

// Utility: returns the distance from point (px,py) to the segment from (x0,y0) to (x1,y1)
function pointToSegmentDistance(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const A = dx * dx + dy * dy;
  const B = 2 * ((x0 - px) * dx + (y0 - py) * dy);
  const C = (x0 - px) ** 2 + (y0 - py) ** 2;
  const discriminant = B * B - 4 * A * C;
  let t = 0;
  if (discriminant >= 0) {
    const t1 = (-B + Math.sqrt(discriminant)) / (2 * A);
    const t2 = (-B - Math.sqrt(discriminant)) / (2 * A);
    if (t1 >= 0 && t1 <= 1) t = t1;
    else if (t2 >= 0 && t2 <= 1) t = t2;
  }
  const ix = x0 + t * dx;
  const iy = y0 + t * dy;
  return Math.hypot(px - ix, py - iy);
}

// Compute intersection of a segment with a circle (center (cx,cy), radius r)
function intersectSegmentCircle(p0, p1, cx, cy, r) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const A = dx * dx + dy * dy;
  const B = 2 * ((p0.x - cx) * dx + (p0.y - cy) * dy);
  const C = (p0.x - cx) ** 2 + (p0.y - cy) ** 2 - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  // Choose the intersection that lies between 0 and 1
  const t1 = (-B + sqrtDisc) / (2 * A);
  const t2 = (-B - sqrtDisc) / (2 * A);
  let t = null;
  if (t1 >= 0 && t1 <= 1) t = t1;
  else if (t2 >= 0 && t2 <= 1) t = t2;
  if (t === null) return null;
  return { x: p0.x + t * dx, y: p0.y + t * dy };
}

// New split function: process each segment of a stroke and remove portions inside the eraser,
// while computing intersection points if the segment crosses the eraser circle.
// This version tries to preserve the curve by using the actual intersection points.
function splitStrokeByEraser(stroke, cx, cy, r) {
  let segments = [];
  let currentSegment = [];
  const pts = stroke.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const d0 = Math.hypot(p0.x - cx, p0.y - cy);
    const d1 = Math.hypot(p1.x - cx, p1.y - cy);
    
    // If p0 is outside, include it
    if (d0 >= r) {
      if (currentSegment.length === 0) currentSegment.push(p0);
    }
    
    // Check if the segment crosses the eraser circle
    if ((d0 >= r && d1 < r) || (d0 < r && d1 >= r)) {
      const ip = intersectSegmentCircle(p0, p1, cx, cy, r);
      if (ip) currentSegment.push(ip);
    }
    
    // If p1 is outside, include it and continue the segment
    if (d1 >= r) {
      currentSegment.push(p1);
    }
    
    // If both p0 and p1 are inside, end current segment if non-empty
    if (d0 < r && d1 < r && currentSegment.length > 0) {
      if (currentSegment.length >= 2) segments.push(currentSegment);
      currentSegment = [];
    }
  }
  if (currentSegment.length >= 2) segments.push(currentSegment);
  return segments;
}

// Eraser: Process all objects hit by the eraser. For each stroke hit, split it into segments.
function eraseAt(x, y) {
  const r = parseInt(brushSize.value) / 2;
  // Collect indices of objects hit
  let indices = [];
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj.type === 'stroke') {
      // Check if any segment of the stroke is close to the eraser
      if (obj.points.some(pt => Math.hypot(pt.x - x, pt.y - y) < r)) {
        indices.push(i);
      }
    } else if (obj.type === 'text') {
      ctx.font = obj.font;
      const w = ctx.measureText(obj.text).width;
      const h = parseInt(obj.font, 10) || 20;
      if (x >= obj.x - r && x <= obj.x + w + r && y >= obj.y - h - r && y <= obj.y + r) {
        indices.push(i);
      }
    }
  }
  // Process in descending order to avoid shifting indices
  indices.sort((a, b) => b - a);
  indices.forEach(i => {
    const obj = objects[i];
    if (obj.type === 'stroke') {
      const segs = splitStrokeByEraser(obj, x, y, r);
      objects.splice(i, 1);
      segs.forEach(seg => {
        if (seg.length >= 2) {
          objects.push({
            type: 'stroke',
            points: seg,
            color: obj.color,
            lineWidth: obj.lineWidth,
            opacity: obj.opacity
          });
        }
      });
    } else if (obj.type === 'text') {
      objects.splice(i, 1);
    }
  });
}

// Hit test for move mode
function hitTest(x, y, obj) {
  if (obj.type === 'stroke') {
    for (let i = 0; i < obj.points.length - 1; i++) {
      const p0 = obj.points[i], p1 = obj.points[i + 1];
      if (pointToSegmentDistance(x, y, p0.x, p0.y, p1.x, p1.y) < 5) return true;
    }
  } else if (obj.type === 'text') {
    ctx.font = obj.font;
    const w = ctx.measureText(obj.text).width;
    const h = parseInt(obj.font, 10) || 20;
    if (x >= obj.x && x <= obj.x + w && y >= obj.y - h && y <= obj.y) return true;
  }
  return false;
}

// Redraw canvas
function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  objects.forEach(obj => {
    if (obj.type === 'stroke') {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.lineWidth;
      ctx.globalAlpha = obj.opacity;
      ctx.beginPath();
      if (obj.points.length) {
        ctx.moveTo(obj.points[0].x, obj.points[0].y);
        if (obj.points.length === 1) {
          ctx.lineTo(obj.points[0].x, obj.points[0].y);
        } else {
          for (let i = 0; i < obj.points.length - 1; i++) {
            const midX = (obj.points[i].x + obj.points[i+1].x) / 2;
            const midY = (obj.points[i].y + obj.points[i+1].y) / 2;
            ctx.quadraticCurveTo(obj.points[i].x, obj.points[i].y, midX, midY);
          }
          ctx.lineTo(obj.points[obj.points.length - 1].x, obj.points[obj.points.length - 1].y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (obj.type === 'text') {
      ctx.font = obj.font;
      ctx.fillStyle = obj.color;
      ctx.fillText(obj.text, obj.x, obj.y);
    }
  });
}

// Mouse event handling
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  // Text tool: prompt for text input
  if (currentMode === 'text') {
    const txt = prompt("Enter text:");
    if (txt) {
      objects.push({
        type: 'text',
        x: x,
        y: y,
        text: txt,
        color: colorPicker.value,
        font: "20px sans-serif"
      });
      redraw();
    }
    return;
  }
  
  if (currentMode === 'pen' || currentMode === 'highlighter') {
    isDrawing = true;
    currentStroke = {
      type: 'stroke',
      points: [{ x, y }],
      color: colorPicker.value,
      lineWidth: parseInt(brushSize.value),
      opacity: currentMode === 'pen' ? 1 : 0.3
    };
    objects.push(currentStroke);
    redoStack.length = 0;
  } else if (currentMode === 'eraser') {
    isDrawing = true;
    eraseAt(x, y);
    redraw();
  } else if (currentMode === 'line') {
    isDrawing = true;
    currentLine = {
      type: 'line',
      startX: x,
      startY: y,
      endX: x,
      endY: y,
      color: colorPicker.value,
      lineWidth: parseInt(brushSize.value)
    };
    redoStack.length = 0;
  } else if (currentMode === 'move') {
    for (let i = objects.length - 1; i >= 0; i--) {
      if (hitTest(x, y, objects[i])) {
        selectedObject = objects[i];
        if (selectedObject.type === 'stroke' || selectedObject.type === 'text') {
          moveOffset.dx = x - (selectedObject.x || selectedObject.points[0].x);
          moveOffset.dy = y - (selectedObject.y || selectedObject.points[0].y);
        }
        break;
      }
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  if (currentMode === 'eraser' && isDrawing) {
    eraseAt(x, y);
    redraw();
  } else if ((currentMode === 'pen' || currentMode === 'highlighter') && isDrawing) {
    currentStroke.points.push({ x, y });
    redraw();
  } else if (currentMode === 'line' && isDrawing && currentLine) {
    currentLine.endX = x;
    currentLine.endY = y;
    redraw();
    ctx.strokeStyle = currentLine.color;
    ctx.lineWidth = currentLine.lineWidth;
    ctx.beginPath();
    ctx.moveTo(currentLine.startX, currentLine.startY);
    ctx.lineTo(currentLine.endX, currentLine.endY);
    ctx.stroke();
  } else if (currentMode === 'move' && selectedObject) {
    if (selectedObject.type === 'stroke') {
      const dx = x - (selectedObject.x || selectedObject.points[0].x) - moveOffset.dx;
      const dy = y - (selectedObject.y || selectedObject.points[0].y) - moveOffset.dy;
      selectedObject.points = selectedObject.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
      moveOffset.dx = x - (selectedObject.x || selectedObject.points[0].x);
      moveOffset.dy = y - (selectedObject.y || selectedObject.points[0].y);
      redraw();
    } else if (selectedObject.type === 'text') {
      selectedObject.x = x - moveOffset.dx;
      selectedObject.y = y - moveOffset.dy;
      redraw();
    }
  }
});

canvas.addEventListener('mouseup', () => {
  if ((currentMode === 'pen' || currentMode === 'highlighter' || currentMode === 'eraser') && isDrawing) {
    isDrawing = false;
    currentStroke = null;
  } else if (currentMode === 'line' && isDrawing && currentLine) {
    isDrawing = false;
    const steps = 20;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      pts.push({
        x: currentLine.startX + (currentLine.endX - currentLine.startX) * (i / steps),
        y: currentLine.startY + (currentLine.endY - currentLine.startY) * (i / steps)
      });
    }
    objects.push({
      type: 'stroke',
      points: pts,
      color: currentLine.color,
      lineWidth: currentLine.lineWidth,
      opacity: 1
    });
    currentLine = null;
    redraw();
  }
  if (currentMode === 'move') {
    selectedObject = null;
  }
});
