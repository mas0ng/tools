const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');

// Declare objects array so that all drawn objects are stored.
const objects = [];

// Drawing state variables and shape preview
let currentMode = 'pen'; // Modes: 'pen', 'highlighter', 'eraser', 'rectangle', 'circle', 'line', 'text', 'move'
let isDrawing = false;
let currentStroke = null;
let currentShape = null; // For rectangle, circle, and line previews
let selectedObject = null;
let moveOffset = { x: 0, y: 0 };
let liveText = null; // For live text preview
let textInput = null; // DOM element for text input

// Adjust canvas size to full window and redraw content
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  redraw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Toolbar elements
const penBtn = document.getElementById('penBtn');
const highlighterBtn = document.getElementById('highlighterBtn');
const eraserBtn = document.getElementById('eraserBtn');
const rectBtn = document.getElementById('rectBtn');
const circleBtn = document.getElementById('circleBtn');
const lineBtn = document.getElementById('lineBtn');
const textBtn = document.getElementById('textBtn');
const moveBtn = document.getElementById('moveBtn');
const colorPicker = document.getElementById('colorPicker');
const brushSize = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');

// Set active button appearance
function setActiveButton(button) {
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  button.classList.add('active');
}

// Toolbar event listeners
penBtn.addEventListener('click', () => { currentMode = 'pen'; setActiveButton(penBtn); });
highlighterBtn.addEventListener('click', () => { currentMode = 'highlighter'; setActiveButton(highlighterBtn); });
eraserBtn.addEventListener('click', () => { currentMode = 'eraser'; setActiveButton(eraserBtn); });
rectBtn.addEventListener('click', () => { currentMode = 'rectangle'; setActiveButton(rectBtn); });
circleBtn.addEventListener('click', () => { currentMode = 'circle'; setActiveButton(circleBtn); });
lineBtn.addEventListener('click', () => { currentMode = 'line'; setActiveButton(lineBtn); });
textBtn.addEventListener('click', () => { currentMode = 'text'; setActiveButton(textBtn); });
moveBtn.addEventListener('click', () => { currentMode = 'move'; setActiveButton(moveBtn); });

// Clear button: confirm before clearing
clearBtn.addEventListener('click', () => {
  if (confirm("Are you sure you want to clear the canvas?")) {
    objects.length = 0;
    liveText = null;
    if (textInput) {
      document.body.removeChild(textInput);
      textInput = null;
    }
    redraw();
  }
});

// Save button: save the canvas as a JPEG image with a white background
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

// Utility: calculates the distance from a point to a line segment (used for stroke hit testing)
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1, B = py - y1;
  const C = x2 - x1, D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = lenSq ? dot / lenSq : -1;
  let xx, yy;
  if (param < 0) { xx = x1; yy = y1; }
  else if (param > 1) { xx = x2; yy = y2; }
  else { xx = x1 + param * C; yy = y1 + param * D; }
  const dx = px - xx, dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Updated Eraser function: truly remove parts of strokes by splitting them into segments
function eraseAt(x, y) {
  const eraserRadius = parseInt(brushSize.value) / 2;
  // Iterate backwards over all objects
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj.type === 'stroke') {
      let segments = [];
      let currentSegment = [];
      // Split the stroke: if a point is within the eraser, end the current segment.
      for (let j = 0; j < obj.points.length; j++) {
        const pt = obj.points[j];
        if (Math.hypot(pt.x - x, pt.y - y) > eraserRadius) {
          currentSegment.push(pt);
        } else {
          if (currentSegment.length > 1) {
            segments.push(currentSegment);
          }
          currentSegment = [];
        }
      }
      if (currentSegment.length > 1) {
        segments.push(currentSegment);
      }
      // Replace the stroke with its remaining segments (if any)
      if (segments.length === 0) {
        objects.splice(i, 1);
      } else {
        objects.splice(i, 1);
        for (let seg of segments) {
          objects.push({
            type: 'stroke',
            points: seg,
            color: obj.color,
            lineWidth: obj.lineWidth,
            opacity: obj.opacity
          });
        }
      }
    } else if (obj.type === 'line') {
      if (pointToSegmentDistance(x, y, obj.startX, obj.startY, obj.endX, obj.endY) < eraserRadius) {
        objects.splice(i, 1);
      }
    } else if (obj.type === 'rectangle') {
      const x0 = Math.min(obj.startX, obj.endX);
      const y0 = Math.min(obj.startY, obj.endY);
      const width = Math.abs(obj.endX - obj.startX);
      const height = Math.abs(obj.endY - obj.startY);
      if (x >= x0 - eraserRadius && x <= x0 + width + eraserRadius &&
          y >= y0 - eraserRadius && y <= y0 + height + eraserRadius) {
        objects.splice(i, 1);
      }
    } else if (obj.type === 'circle') {
      const circleRadius = Math.hypot(obj.endX - obj.startX, obj.endY - obj.startY);
      if (Math.hypot(x - obj.startX, y - obj.startY) < circleRadius + eraserRadius) {
        objects.splice(i, 1);
      }
    } else if (obj.type === 'text') {
      ctx.font = obj.font;
      const textWidth = ctx.measureText(obj.text).width;
      const textHeight = parseInt(obj.font, 10) || 16;
      if (x >= obj.x - eraserRadius && x <= obj.x + textWidth + eraserRadius &&
          y >= obj.y - textHeight - eraserRadius && y <= obj.y + eraserRadius) {
        objects.splice(i, 1);
      }
    }
  }
}

// Hit test (used in move mode)
function hitTest(x, y, obj) {
  if (obj.type === 'stroke') {
    for (let i = 0; i < obj.points.length - 1; i++) {
      const p1 = obj.points[i], p2 = obj.points[i + 1];
      if (pointToSegmentDistance(x, y, p1.x, p1.y, p2.x, p2.y) < 5) return true;
    }
  } else if (obj.type === 'line') {
    if (pointToSegmentDistance(x, y, obj.startX, obj.startY, obj.endX, obj.endY) < 5) return true;
  } else if (obj.type === 'text') {
    ctx.font = obj.font;
    const textWidth = ctx.measureText(obj.text).width;
    const textHeight = parseInt(obj.font, 10) || 16;
    if (x >= obj.x && x <= obj.x + textWidth && y >= obj.y - textHeight && y <= obj.y) return true;
  } else if (obj.type === 'rectangle') {
    const x0 = Math.min(obj.startX, obj.endX);
    const y0 = Math.min(obj.startY, obj.endY);
    const width = Math.abs(obj.endX - obj.startX);
    const height = Math.abs(obj.endY - obj.startY);
    if (x >= x0 && x <= x0 + width && y >= y0 && y <= y0 + height) return true;
  } else if (obj.type === 'circle') {
    const radius = Math.hypot(obj.endX - obj.startX, obj.endY - obj.startY);
    if (Math.hypot(x - obj.startX, y - obj.startY) <= radius) return true;
  }
  return false;
}

// Redraw all objects and live text
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
      obj.points.forEach((pt, index) => {
        if (index === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (obj.type === 'line') {
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.lineWidth;
      ctx.moveTo(obj.startX, obj.startY);
      ctx.lineTo(obj.endX, obj.endY);
      ctx.stroke();
    } else if (obj.type === 'text') {
      ctx.font = obj.font;
      ctx.fillStyle = obj.color;
      ctx.fillText(obj.text, obj.x, obj.y);
    } else if (obj.type === 'rectangle') {
      const x0 = Math.min(obj.startX, obj.endX);
      const y0 = Math.min(obj.startY, obj.endY);
      const width = Math.abs(obj.endX - obj.startX);
      const height = Math.abs(obj.endY - obj.startY);
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.lineWidth;
      ctx.strokeRect(x0, y0, width, height);
    } else if (obj.type === 'circle') {
      const radius = Math.hypot(obj.endX - obj.startX, obj.endY - obj.startY);
      ctx.beginPath();
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.lineWidth;
      ctx.arc(obj.startX, obj.startY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
  });
  
  if (liveText && liveText.text) {
    ctx.font = liveText.font;
    ctx.fillStyle = liveText.color;
    ctx.fillText(liveText.text, liveText.x, liveText.y);
  }
}

// Text input functions
function startTextInput(x, y) {
  if (textInput) commitText();
  textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "text-input";
  textInput.style.left = x + "px";
  textInput.style.top = y + "px";
  textInput.style.color = colorPicker.value;
  textInput.style.font = "20px sans-serif";
  document.body.appendChild(textInput);
  textInput.focus();
  
  liveText = {
    type: 'text',
    x: x,
    y: y + 20,
    text: "",
    color: colorPicker.value,
    font: "20px sans-serif"
  };
  
  textInput.addEventListener("input", () => {
    liveText.text = textInput.value;
    liveText.color = colorPicker.value;
    redraw();
  });
  
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitText();
  });
  
  textInput.addEventListener("blur", () => { commitText(); });
}

function commitText() {
  if (textInput) {
    if (liveText.text.trim() !== "") {
      objects.push({
        type: 'text',
        x: liveText.x,
        y: liveText.y,
        text: liveText.text,
        color: liveText.color,
        font: liveText.font
      });
    }
    document.body.removeChild(textInput);
    textInput = null;
    liveText = null;
    redraw();
  }
}

// Mouse event handling
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  if (textInput && currentMode === 'text') {
    commitText();
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
  }
  else if (currentMode === 'eraser') {
    isDrawing = true;
    eraseAt(x, y);
    redraw();
  }
  else if (currentMode === 'rectangle' || currentMode === 'circle' || currentMode === 'line') {
    isDrawing = true;
    currentShape = {
      type: currentMode,
      startX: x,
      startY: y,
      endX: x,
      endY: y,
      color: colorPicker.value,
      lineWidth: parseInt(brushSize.value)
    };
  }
  else if (currentMode === 'text') {
    startTextInput(e.clientX, e.clientY);
  }
  else if (currentMode === 'move') {
    for (let i = objects.length - 1; i >= 0; i--) {
      if (hitTest(x, y, objects[i])) {
        selectedObject = objects[i];
        if (selectedObject.type === 'stroke' ||
            selectedObject.type === 'rectangle' ||
            selectedObject.type === 'circle' ||
            selectedObject.type === 'line') {
          moveOffset.x = x;
          moveOffset.y = y;
        } else if (selectedObject.type === 'text') {
          moveOffset.x = x - selectedObject.x;
          moveOffset.y = y - selectedObject.y;
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
  
  if ((currentMode === 'pen' || currentMode === 'highlighter') && isDrawing) {
    currentStroke.points.push({ x, y });
    redraw();
  }
  else if (currentMode === 'eraser' && isDrawing) {
    eraseAt(x, y);
    redraw();
  }
  else if ((currentMode === 'rectangle' || currentMode === 'circle' || currentMode === 'line') && isDrawing && currentShape) {
    currentShape.endX = x;
    currentShape.endY = y;
    redraw();
    ctx.strokeStyle = currentShape.color;
    ctx.lineWidth = currentShape.lineWidth;
    if (currentShape.type === 'rectangle') {
      const x0 = Math.min(currentShape.startX, currentShape.endX);
      const y0 = Math.min(currentShape.startY, currentShape.endY);
      const width = Math.abs(currentShape.endX - currentShape.startX);
      const height = Math.abs(currentShape.endY - currentShape.startY);
      ctx.strokeRect(x0, y0, width, height);
    } else if (currentShape.type === 'circle') {
      const radius = Math.hypot(currentShape.endX - currentShape.startX, currentShape.endY - currentShape.startY);
      ctx.beginPath();
      ctx.arc(currentShape.startX, currentShape.startY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (currentShape.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(currentShape.startX, currentShape.startY);
      ctx.lineTo(currentShape.endX, currentShape.endY);
      ctx.stroke();
    }
  }
  else if (currentMode === 'move' && selectedObject) {
    if (selectedObject.type === 'stroke') {
      const dx = x - moveOffset.x;
      const dy = y - moveOffset.y;
      selectedObject.points = selectedObject.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
      moveOffset.x = x;
      moveOffset.y = y;
      redraw();
    } else if (selectedObject.type === 'text') {
      selectedObject.x = x - moveOffset.x;
      selectedObject.y = y - moveOffset.y;
      redraw();
    } else if (selectedObject.type === 'rectangle' ||
               selectedObject.type === 'circle' ||
               selectedObject.type === 'line') {
      const dx = x - moveOffset.x;
      const dy = y - moveOffset.y;
      selectedObject.startX += dx;
      selectedObject.startY += dy;
      selectedObject.endX += dx;
      selectedObject.endY += dy;
      moveOffset.x = x;
      moveOffset.y = y;
      redraw();
    }
  }
});

canvas.addEventListener('mouseup', () => {
  if ((currentMode === 'pen' || currentMode === 'highlighter' || currentMode === 'eraser') && isDrawing) {
    isDrawing = false;
    currentStroke = null;
  }
  else if ((currentMode === 'rectangle' || currentMode === 'circle' || currentMode === 'line') && isDrawing && currentShape) {
    isDrawing = false;
    objects.push(currentShape);
    currentShape = null;
    redraw();
  }
  if (currentMode === 'move' && selectedObject) {
    selectedObject = null;
  }
});
