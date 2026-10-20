import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MousePointer2, Pencil, Eraser, Type, StickyNote, Minus, MoveRight, PaintBucket, Pipette, Trash2, Undo2, Redo2, Copy, ClipboardPaste, ZoomIn, ZoomOut, Download, ImageDown, Square, Circle as CircleIcon, Triangle as TriangleIcon, Diamond, Star, Hexagon, Pentagon } from "lucide-react";
import socket from "../../services/socket";
import {
  Canvas,
  Rect,
  Circle,
  Triangle,
  Ellipse,
  Polygon,
  Line,
  IText,
  Path,
  PencilBrush,
} from "fabric";

function Whiteboard({ roomId }) {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const activeToolRef = useRef("select");
  const erasingRef = useRef(false);

  // État du tracé en cours (outils « ligne » et « flèche ») : cette référence
  // était utilisée partout sans jamais être déclarée, ce qui faisait échouer le
  // tracé avec une ReferenceError.
  const drawingRef = useRef({ start: null, preview: null });

  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const clipboardRef = useRef([]);

  const styleRef = useRef({
    primaryColor: "#111827",
    secondaryColor: "#ffffff",
    strokeWidth: 2,
    transparentFill: true,
    transparentStroke: false,
    dashedStroke: false,
  });

  const [activeTool, setActiveTool] =
    useState("select");

  const [primaryColor, setPrimaryColor] =
    useState("#111827");

  const [secondaryColor, setSecondaryColor] =
    useState("#ffffff");

  const [paletteTarget, setPaletteTarget] =
    useState("primary");

  const [strokeWidth, setStrokeWidth] =
    useState(2);

  const [transparentFill, setTransparentFill] =
    useState(true);

  const [transparentStroke, setTransparentStroke] =
    useState(false);

  const [dashedStroke, setDashedStroke] =
    useState(false);

  // État résiduel : seule la remise à zéro lors du choix d'un outil est
  // utilisée. La valeur n'est lue nulle part, d'où la case vide.
  const [, setShowMoreShapes] = useState(true);

  const [zoom, setZoom] = useState(1);

  const [remoteCursors, setRemoteCursors] =
    useState({});

  useEffect(() => {
    styleRef.current = {
      primaryColor,
      secondaryColor,
      strokeWidth,
      transparentFill,
      transparentStroke,
      dashedStroke,
    };
  }, [
    primaryColor,
    secondaryColor,
    strokeWidth,
    transparentFill,
    transparentStroke,
    dashedStroke,
  ]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    const canvas = new Canvas(
      canvasRef.current,
      {
        width: 1100,
        height: 650,
        backgroundColor: "#ffffff",
        preserveObjectStacking: true,
        selection: true,
      }
    );

    fabricCanvasRef.current = canvas;

    historyRef.current = [
      JSON.stringify(canvas.toJSON()),
    ];

    redoRef.current = [];

    function getPoint(event) {
      return (
        event.scenePoint ||
        canvas.getScenePoint(event.e)
      );
    }

    function getShapeStyle() {
      const current =
        styleRef.current;

      return {
        fill: current.transparentFill
          ? null
          : current.secondaryColor,
        stroke:
          current.transparentStroke
            ? null
            : current.primaryColor,
        strokeWidth:
          current.strokeWidth,
        strokeDashArray:
          current.dashedStroke
            ? [8, 6]
            : null,
        strokeLineCap: "round",
        strokeLineJoin: "round",
      };
    }

    function createRegularPolygon(
      sides,
      radius
    ) {
      const points = [];

      for (let index = 0; index < sides; index++) {
        const angle =
          (index * 2 * Math.PI) / sides -
          Math.PI / 2;

        points.push({
          x:
            radius +
            radius *
              Math.cos(angle),
          y:
            radius +
            radius *
              Math.sin(angle),
        });
      }

      return points;
    }

    function createStarPoints(
      outerRadius,
      innerRadius
    ) {
      const points = [];

      for (let index = 0; index < 10; index++) {
        const angle =
          (index * Math.PI) / 5 -
          Math.PI / 2;

        const radius =
          index % 2 === 0
            ? outerRadius
            : innerRadius;

        points.push({
          x:
            outerRadius +
            radius *
              Math.cos(angle),
          y:
            outerRadius +
            radius *
              Math.sin(angle),
        });
      }

      return points;
    }

    function addShape(type) {
      let object;

      const common =
        getShapeStyle();

      if (type === "rectangle") {
        object = new Rect({
          left: 430,
          top: 250,
          width: 180,
          height: 120,
          rx: 6,
          ry: 6,
          ...common,
        });
      }

      if (type === "circle") {
        object = new Circle({
          left: 460,
          top: 260,
          radius: 65,
          ...common,
        });
      }

      if (type === "triangle") {
        object = new Triangle({
          left: 455,
          top: 255,
          width: 140,
          height: 130,
          ...common,
        });
      }

      if (type === "ellipse") {
        object = new Ellipse({
          left: 430,
          top: 270,
          rx: 90,
          ry: 55,
          ...common,
        });
      }

      if (type === "diamond") {
        object = new Polygon(
          [
            { x: 90, y: 0 },
            { x: 180, y: 90 },
            { x: 90, y: 180 },
            { x: 0, y: 90 },
          ],
          {
            left: 425,
            top: 235,
            ...common,
          }
        );
      }

      if (type === "pentagon") {
        object = new Polygon(
          createRegularPolygon(
            5,
            80
          ),
          {
            left: 430,
            top: 235,
            ...common,
          }
        );
      }

      if (type === "hexagon") {
        object = new Polygon(
          createRegularPolygon(
            6,
            80
          ),
          {
            left: 430,
            top: 235,
            ...common,
          }
        );
      }

      if (type === "star") {
        object = new Polygon(
          createStarPoints(
            85,
            38
          ),
          {
            left: 430,
            top: 235,
            ...common,
          }
        );
      }

      if (!object) {
        return;
      }

      canvas.isDrawingMode = false;
      canvas.selection = true;

      canvas.add(object);
      canvas.setActiveObject(object);
      canvas.renderAll();

      saveHistory();
      sendCanvasUpdate();

      activeToolRef.current =
        "select";

      setActiveTool("select");
    }

    function addLine(start, end) {
      const object = new Line(
        [
          start.x,
          start.y,
          end.x,
          end.y,
        ],
        {
          stroke:
            styleRef.current
              .transparentStroke
              ? null
              : styleRef.current
                  .primaryColor,
          strokeWidth:
            styleRef.current
              .strokeWidth,
          strokeDashArray:
            styleRef.current
              .dashedStroke
              ? [8, 6]
              : null,
          strokeLineCap:
            "round",
        }
      );

      canvas.add(object);
      canvas.setActiveObject(
        object
      );
      canvas.renderAll();

      saveHistory();
      sendCanvasUpdate();

      setActiveTool("select");
      activeToolRef.current =
        "select";
    }

    function addArrow(start, end) {
      const dx =
        end.x - start.x;
      const dy =
        end.y - start.y;

      const length = Math.sqrt(
        dx * dx + dy * dy
      );

      if (length < 8) {
        return;
      }

      const angle = Math.atan2(
        dy,
        dx
      );

      const arrowSize = 16;

      const point1X =
        end.x -
        arrowSize *
          Math.cos(
            angle - Math.PI / 6
          );

      const point1Y =
        end.y -
        arrowSize *
          Math.sin(
            angle - Math.PI / 6
          );

      const point2X =
        end.x -
        arrowSize *
          Math.cos(
            angle + Math.PI / 6
          );

      const point2Y =
        end.y -
        arrowSize *
          Math.sin(
            angle + Math.PI / 6
          );

      const path = `
        M ${start.x} ${start.y}
        L ${end.x} ${end.y}
        M ${end.x} ${end.y}
        L ${point1X} ${point1Y}
        M ${end.x} ${end.y}
        L ${point2X} ${point2Y}
      `;

      const object = new Path(
        path,
        {
          stroke:
            styleRef.current
              .transparentStroke
              ? null
              : styleRef.current
                  .primaryColor,
          strokeWidth:
            styleRef.current
              .strokeWidth,
          strokeDashArray:
            styleRef.current
              .dashedStroke
              ? [8, 6]
              : null,
          fill: null,
          strokeLineCap:
            "round",
          strokeLineJoin:
            "round",
        }
      );

      canvas.add(object);
      canvas.setActiveObject(
        object
      );
      canvas.renderAll();

      saveHistory();
      sendCanvasUpdate();

      setActiveTool("select");
      activeToolRef.current =
        "select";
    }

    function removeObjectAtPointer(event) {
      const target =
        canvas.findTarget(
          event.e
        );

      if (!target) {
        return;
      }

      canvas.remove(target);
      canvas.discardActiveObject();
      canvas.renderAll();

      saveHistory();
      sendCanvasUpdate();
    }

    function fillObjectAtPointer(
      event
    ) {
      const target =
        canvas.findTarget(
          event.e
        );

      if (!target) {
        return;
      }

      const color =
        styleRef.current
          .secondaryColor;

      target.set({
        fill: color,
      });

      canvas.renderAll();

      saveHistory();
      sendCanvasUpdate();
    }

    function pickColorAtPointer(
      event
    ) {
      const target =
        canvas.findTarget(
          event.e
        );

      if (!target) {
        return;
      }

      const detected =
        target.fill &&
        target.fill !==
          "transparent"
          ? target.fill
          : target.stroke;

      if (
        typeof detected !==
        "string"
      ) {
        return;
      }

      setPrimaryColor(
        detected
      );

      setSecondaryColor(
        detected
      );
    }

    function handleMouseDown(
      event
    ) {
      const tool =
        activeToolRef.current;

      if (tool === "eraser") {
        erasingRef.current =
          true;

        removeObjectAtPointer(
          event
        );

        return;
      }

      if (tool === "fill") {
        fillObjectAtPointer(
          event
        );

        return;
      }

      if (tool === "picker") {
        pickColorAtPointer(
          event
        );

        return;
      }

      if (
        tool === "draw" ||
        tool === "select"
      ) {
        return;
      }

      const point =
        getPoint(event);

      if (
        tool === "text" ||
        tool === "note"
      ) {
        const object =
          tool === "note"
            ? new IText(
                "Nouvelle note",
                {
                  left: point.x,
                  top: point.y,
                  fontSize: 20,
                  fill: "#111827",
                  backgroundColor:
                    "#fef08a",
                  padding: 10,
                }
              )
            : new IText(
                "Texte",
                {
                  left: point.x,
                  top: point.y,
                  fontSize: 24,
                  fill:
                    styleRef.current
                      .primaryColor,
                }
              );

        canvas.add(object);
        canvas.setActiveObject(
          object
        );
        canvas.renderAll();

        saveHistory();
        sendCanvasUpdate();

        setActiveTool("select");
        activeToolRef.current =
          "select";

        setTimeout(() => {
          object.enterEditing();
          object.selectAll();
        }, 30);

        return;
      }

      if (
        tool === "rectangle" ||
        tool === "circle" ||
        tool === "triangle" ||
        tool === "ellipse" ||
        tool === "diamond" ||
        tool === "pentagon" ||
        tool === "hexagon" ||
        tool === "star"
      ) {
        addShape(tool);
        return;
      }

      if (
        tool === "line" ||
        tool === "arrow"
      ) {
        drawingRef.current =
          {
            start: point,
            preview: null,
          };

        return;
      }
    }

    function handleMouseMove(
      event
    ) {
      const tool =
        activeToolRef.current;

      if (tool === "eraser") {
        if (erasingRef.current) {
          removeObjectAtPointer(
            event
          );
        }

        return;
      }

      if (
        tool !== "line" &&
        tool !== "arrow"
      ) {
        return;
      }

      if (
        !drawingRef.current
          .start
      ) {
        return;
      }

      const point =
        getPoint(event);

      if (
        drawingRef.current
          .preview
      ) {
        canvas.remove(
          drawingRef.current
            .preview
        );

        drawingRef.current
          .preview = null;
      }

      if (tool === "line") {
        const preview =
          new Line(
            [
              drawingRef.current
                .start.x,
              drawingRef.current
                .start.y,
              point.x,
              point.y,
            ],
            {
              stroke:
                styleRef.current
                  .transparentStroke
                  ? null
                  : styleRef.current
                      .primaryColor,
              strokeWidth:
                styleRef.current
                  .strokeWidth,
              strokeDashArray:
                styleRef.current
                  .dashedStroke
                  ? [8, 6]
                  : null,
              strokeLineCap:
                "round",
              selectable: false,
              evented: false,
            }
          );

        drawingRef.current
          .preview = preview;

        canvas.add(preview);
        canvas.renderAll();
      }

      if (tool === "arrow") {
        const dx =
          point.x -
          drawingRef.current
            .start.x;

        const dy =
          point.y -
          drawingRef.current
            .start.y;

        const length = Math.sqrt(
          dx * dx +
            dy * dy
        );

        if (length < 5) {
          return;
        }

        const start =
          drawingRef.current
            .start;

        const angle =
          Math.atan2(
            dy,
            dx
          );

        const arrowSize = 16;

        const point1X =
          point.x -
          arrowSize *
            Math.cos(
              angle -
                Math.PI / 6
            );

        const point1Y =
          point.y -
          arrowSize *
            Math.sin(
              angle -
                Math.PI / 6
            );

        const point2X =
          point.x -
          arrowSize *
            Math.cos(
              angle +
                Math.PI / 6
            );

        const point2Y =
          point.y -
          arrowSize *
            Math.sin(
              angle +
                Math.PI / 6
            );

        const previewPath = `
          M ${start.x} ${start.y}
          L ${point.x} ${point.y}
          M ${point.x} ${point.y}
          L ${point1X} ${point1Y}
          M ${point.x} ${point.y}
          L ${point2X} ${point2Y}
        `;

        const preview =
          new Path(
            previewPath,
            {
              stroke:
                styleRef.current
                  .transparentStroke
                  ? null
                  : styleRef.current
                      .primaryColor,
              strokeWidth:
                styleRef.current
                  .strokeWidth,
              strokeDashArray:
                styleRef.current
                  .dashedStroke
                  ? [8, 6]
                  : null,
              fill: null,
              selectable: false,
              evented: false,
            }
          );

        drawingRef.current
          .preview = preview;

        canvas.add(preview);
        canvas.renderAll();
      }
    }

    function handleMouseUp(
      event
    ) {
      erasingRef.current =
        false;

      const tool =
        activeToolRef.current;

      if (
        tool !== "line" &&
        tool !== "arrow"
      ) {
        return;
      }

      if (
        !drawingRef.current
          .start
      ) {
        return;
      }

      const point =
        getPoint(event);

      if (
        drawingRef.current
          .preview
      ) {
        canvas.remove(
          drawingRef.current
            .preview
        );
      }

      const start =
        drawingRef.current
          .start;

      drawingRef.current = {
        start: null,
        preview: null,
      };

      if (tool === "line") {
        addLine(
          start,
          point
        );
      }

      if (tool === "arrow") {
        addArrow(
          start,
          point
        );
      }
    }

    canvas.on(
      "mouse:down",
      handleMouseDown
    );

    canvas.on(
      "mouse:move",
      handleMouseMove
    );

    canvas.on(
      "mouse:up",
      handleMouseUp
    );

    canvas.on(
      "mouse:out",
      () => {
        erasingRef.current =
          false;
      }
    );

    canvas.on(
      "mouse:move",
      (event) => {
        if (!roomId) {
          return;
        }

        socket.emit(
          "cursor-move",
          {
            roomId,
            x: event.scenePoint.x,
            y: event.scenePoint.y,
          }
        );
      }
    );

    canvas.on(
      "object:modified",
      () => {
        saveHistory();
        sendCanvasUpdate();
      }
    );

    canvas.on(
      "path:created",
      () => {
        saveHistory();
        sendCanvasUpdate();
      }
    );

    return () => {
      canvas.dispose();
      fabricCanvasRef.current =
        null;
    };
  }, [roomId]);

  useEffect(() => {
    function handleCanvasUpdate(
      data
    ) {
      const canvas =
        fabricCanvasRef.current;

      if (!canvas) {
        return;
      }

      canvas
        .loadFromJSON(data)
        .then(() => {
          canvas.renderAll();

          if (
            historyRef.current
              .length <= 1
          ) {
            historyRef.current = [
              JSON.stringify(
                canvas.toJSON()
              ),
            ];

            redoRef.current =
              [];
          }
        });
    }

    socket.on(
      "canvas-update",
      handleCanvasUpdate
    );

    return () => {
      socket.off(
        "canvas-update",
        handleCanvasUpdate
      );
    };
  }, []);

  useEffect(() => {
    function handleCursorMove(
      data
    ) {
      setRemoteCursors(
        (current) => ({
          ...current,
          [data.socketId]: {
            x: data.x,
            y: data.y,
          },
        })
      );
    }

    socket.on(
      "cursor-move",
      handleCursorMove
    );

    return () => {
      socket.off(
        "cursor-move",
        handleCursorMove
      );
    };
  }, []);

  useEffect(() => {
    function handleKeyboard(
      event
    ) {
      const canvas =
        fabricCanvasRef.current;

      if (!canvas) {
        return;
      }

      const active =
        canvas.getActiveObject();

      if (
        active &&
        active.isEditing
      ) {
        return;
      }

      if (
        event.ctrlKey &&
        event.key.toLowerCase() ===
          "c"
      ) {
        event.preventDefault();
        copySelected();
      }

      if (
        event.ctrlKey &&
        event.key.toLowerCase() ===
          "v"
      ) {
        event.preventDefault();
        pasteSelected();
      }

      if (
        event.ctrlKey &&
        event.key.toLowerCase() ===
          "z"
      ) {
        event.preventDefault();
        undo();
      }

      if (
        event.ctrlKey &&
        event.key.toLowerCase() ===
          "y"
      ) {
        event.preventDefault();
        redo();
      }

      if (
        event.key ===
          "Delete" ||
        event.key ===
          "Backspace"
      ) {
        deleteSelected();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyboard
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyboard
      );
    };
  }, []);

  function sendCanvasUpdate() {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas || !roomId) {
      return;
    }

    socket.emit(
      "canvas-update",
      {
        roomId,
        data: canvas.toJSON(),
      }
    );
  }

  function saveHistory() {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const data = JSON.stringify(
      canvas.toJSON()
    );

    const history =
      historyRef.current;

    if (
      history[
        history.length - 1
      ] === data
    ) {
      return;
    }

    history.push(data);

    redoRef.current = [];

    if (history.length > 40) {
      history.shift();
    }
  }

  async function restoreCanvas(
    data
  ) {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    await canvas.loadFromJSON(
      JSON.parse(data)
    );

    canvas.renderAll();
    sendCanvasUpdate();
  }

  async function undo() {
    if (
      historyRef.current
        .length <= 1
    ) {
      return;
    }

    const currentState =
      historyRef.current.pop();

    redoRef.current.push(
      currentState
    );

    await restoreCanvas(
      historyRef.current[
        historyRef.current
          .length - 1
      ]
    );
  }

  async function redo() {
    if (
      redoRef.current
        .length === 0
    ) {
      return;
    }

    const nextState =
      redoRef.current.pop();

    historyRef.current.push(
      nextState
    );

    await restoreCanvas(
      nextState
    );
  }

  function setTool(tool) {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    canvas.isDrawingMode =
      tool === "draw";

    canvas.selection =
      tool === "select";

    if (tool === "draw") {
      canvas.freeDrawingBrush =
        new PencilBrush(
          canvas
        );

      canvas.freeDrawingBrush.width =
        strokeWidth;

      canvas.freeDrawingBrush.color =
        primaryColor;
    }

    activeToolRef.current =
      tool;

    setActiveTool(tool);
    setShowMoreShapes(true);
  }

  function chooseShape(tool) {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    if (
      tool === "rectangle" ||
      tool === "circle" ||
      tool === "triangle" ||
      tool === "ellipse" ||
      tool === "diamond" ||
      tool === "pentagon" ||
      tool === "hexagon" ||
      tool === "star"
    ) {
      addImmediateShape(
        tool
      );

      return;
    }

    setTool(tool);
  }

  function addImmediateShape(
    type
  ) {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const common = {
      fill: transparentFill
        ? null
        : secondaryColor,
      stroke:
        transparentStroke
          ? null
          : primaryColor,
      strokeWidth,
      strokeDashArray:
        dashedStroke
          ? [8, 6]
          : null,
      strokeLineCap: "round",
      strokeLineJoin:
        "round",
    };

    let object;

    if (type === "rectangle") {
      object = new Rect({
        left: 440,
        top: 250,
        width: 180,
        height: 120,
        rx: 6,
        ry: 6,
        ...common,
      });
    }

    if (type === "circle") {
      object = new Circle({
        left: 465,
        top: 260,
        radius: 65,
        ...common,
      });
    }

    if (type === "triangle") {
      object = new Triangle({
        left: 460,
        top: 250,
        width: 140,
        height: 130,
        ...common,
      });
    }

    if (type === "ellipse") {
      object = new Ellipse({
        left: 430,
        top: 270,
        rx: 90,
        ry: 55,
        ...common,
      });
    }

    if (type === "diamond") {
      object = new Polygon(
        [
          {
            x: 90,
            y: 0,
          },
          {
            x: 180,
            y: 90,
          },
          {
            x: 90,
            y: 180,
          },
          {
            x: 0,
            y: 90,
          },
        ],
        {
          left: 430,
          top: 235,
          ...common,
        }
      );
    }

    if (type === "pentagon") {
      object = new Polygon(
        createPolygonPoints(
          5,
          80
        ),
        {
          left: 450,
          top: 245,
          ...common,
        }
      );
    }

    if (type === "hexagon") {
      object = new Polygon(
        createPolygonPoints(
          6,
          80
        ),
        {
          left: 450,
          top: 245,
          ...common,
        }
      );
    }

    if (type === "star") {
      object = new Polygon(
        createStarPoints(
          85,
          38
        ),
        {
          left: 445,
          top: 240,
          ...common,
        }
      );
    }

    if (!object) {
      return;
    }

    canvas.isDrawingMode = false;
    canvas.selection = true;

    canvas.add(object);
    canvas.setActiveObject(
      object
    );
    canvas.renderAll();

    saveHistory();
    sendCanvasUpdate();

    setTool("select");
  }

  function createPolygonPoints(
    sides,
    radius
  ) {
    const points = [];

    for (
      let index = 0;
      index < sides;
      index++
    ) {
      const angle =
        (index * 2 * Math.PI) /
          sides -
        Math.PI / 2;

      points.push({
        x:
          radius +
          radius *
            Math.cos(angle),
        y:
          radius +
          radius *
            Math.sin(angle),
      });
    }

    return points;
  }

  function createStarPoints(
    outerRadius,
    innerRadius
  ) {
    const points = [];

    for (
      let index = 0;
      index < 10;
      index++
    ) {
      const angle =
        (index * Math.PI) / 5 -
        Math.PI / 2;

      const radius =
        index % 2 === 0
          ? outerRadius
          : innerRadius;

      points.push({
        x:
          outerRadius +
          radius *
            Math.cos(angle),
        y:
          outerRadius +
          radius *
            Math.sin(angle),
      });
    }

    return points;
  }

  function choosePaletteColor(
    color
  ) {
    if (
      paletteTarget ===
      "primary"
    ) {
      setPrimaryColor(color);

      const canvas =
        fabricCanvasRef.current;

      if (!canvas) {
        return;
      }

      const object =
        canvas.getActiveObject();

      if (!object) {
        return;
      }

      if (
        object.type ===
        "i-text"
      ) {
        object.set({
          fill: color,
        });
      } else {
        object.set({
          stroke:
            transparentStroke
              ? null
              : color,
        });
      }

      canvas.renderAll();

      saveHistory();
      sendCanvasUpdate();
      return;
    }

    setSecondaryColor(
      color
    );

    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const object =
      canvas.getActiveObject();

    if (!object) {
      return;
    }

    if (
      object.type !==
      "line" &&
      object.type !==
        "path" &&
      object.type !==
        "i-text"
    ) {
      object.set({
        fill:
          transparentFill
            ? null
            : color,
      });

      canvas.renderAll();

      saveHistory();
      sendCanvasUpdate();
    }
  }

  function chooseStrokeWidth(
    size
  ) {
    setStrokeWidth(size);

    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    if (
      activeToolRef.current ===
      "draw" &&
      canvas.freeDrawingBrush
    ) {
      canvas.freeDrawingBrush.width =
        size;
    }

    const object =
      canvas.getActiveObject();

    if (!object) {
      return;
    }

    object.set({
      strokeWidth: size,
    });

    canvas.renderAll();

    saveHistory();
    sendCanvasUpdate();
  }

  function applyFillSetting(
    checked
  ) {
    setTransparentFill(
      checked
    );

    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const object =
      canvas.getActiveObject();

    if (
      !object ||
      object.type ===
        "line" ||
      object.type ===
        "path" ||
      object.type ===
        "i-text"
    ) {
      return;
    }

    object.set({
      fill: checked
        ? null
        : secondaryColor,
    });

    canvas.renderAll();

    saveHistory();
    sendCanvasUpdate();
  }

  function applyStrokeSetting(
    checked
  ) {
    setTransparentStroke(
      checked
    );

    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const object =
      canvas.getActiveObject();

    if (!object) {
      return;
    }

    object.set({
      stroke: checked
        ? null
        : primaryColor,
    });

    canvas.renderAll();

    saveHistory();
    sendCanvasUpdate();
  }

  function applyDashedSetting(
    checked
  ) {
    setDashedStroke(
      checked
    );

    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const object =
      canvas.getActiveObject();

    if (!object) {
      return;
    }

    object.set({
      strokeDashArray: checked
        ? [8, 6]
        : null,
    });

    canvas.renderAll();

    saveHistory();
    sendCanvasUpdate();
  }

  function fillTool() {
    setTool("fill");
  }

  function pickerTool() {
    setTool("picker");
  }

  function eraserTool() {
    setTool("eraser");
  }

  function deleteSelected() {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const objects =
      canvas.getActiveObjects();

    if (objects.length === 0) {
      return;
    }

    objects.forEach(
      (object) => {
        canvas.remove(
          object
        );
      }
    );

    canvas.discardActiveObject();
    canvas.renderAll();

    saveHistory();
    sendCanvasUpdate();
  }

  async function copySelected() {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const objects =
      canvas.getActiveObjects();

    if (objects.length === 0) {
      return;
    }

    clipboardRef.current =
      await Promise.all(
        objects.map(
          (object) =>
            object.clone()
        )
      );
  }

  async function pasteSelected() {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    if (
      clipboardRef.current
        .length === 0
    ) {
      return;
    }

    const clones =
      await Promise.all(
        clipboardRef.current.map(
          (object) =>
            object.clone()
        )
      );

    clones.forEach(
      (object) => {
        object.set({
          left:
            (object.left ||
              0) + 25,
          top:
            (object.top ||
              0) + 25,
        });

        canvas.add(object);
      }
    );

    if (clones.length === 1) {
      canvas.setActiveObject(
        clones[0]
      );
    }

    canvas.renderAll();

    saveHistory();
    sendCanvasUpdate();
  }

  function changeZoom(
    nextZoom
  ) {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const safeZoom =
      Math.max(
        0.5,
        Math.min(
          2,
          nextZoom
        )
      );

    setZoom(safeZoom);

    canvas.setZoom(
      safeZoom
    );

    canvas.renderAll();
  }

  function exportPNG() {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const dataURL =
      canvas.toDataURL({
        format: "png",
        quality: 1,
        multiplier: 1,
      });

    const link =
      document.createElement(
        "a"
      );

    link.href = dataURL;
    link.download =
      "devmeet-whiteboard.png";

    link.click();
  }

  function exportJPEG() {
    const canvas =
      fabricCanvasRef.current;

    if (!canvas) {
      return;
    }

    const dataURL =
      canvas.toDataURL({
        format: "jpeg",
        quality: 1,
        multiplier: 1,
      });

    const link =
      document.createElement(
        "a"
      );

    link.href = dataURL;
    link.download =
      "devmeet-whiteboard.jpeg";

    link.click();
  }

  const palette = [
    "#000000",
    "#ffffff",
    "#7f1d1d",
    "#dc2626",
    "#f97316",
    "#f59e0b",
    "#eab308",
    "#84cc16",
    "#22c55e",
    "#10b981",
    "#06b6d4",
    "#0ea5e9",
    "#2563eb",
    "#4f46e5",
    "#7c3aed",
    "#a855f7",
    "#db2777",
    "#f43f5e",
    "#64748b",
    "#94a3b8",
  ];

  const topToolStyle = (
    tool
  ) => ({
    width: "66px",
    height: "55px",
    border:
      activeTool === tool
        ? "1px solid #5865f2"
        : "1px solid transparent",
    borderRadius: "5px",
    background:
      activeTool === tool
        ? "#343b4a"
        : "transparent",
    color: "#f0f6fc",
    cursor: "pointer",
    display: "flex",
    flexDirection:
      "column",
    alignItems: "center",
    justifyContent:
      "center",
    gap: "4px",
    fontSize: "9px",
  });

  const iconStyle = {
    fontSize: "18px",
    lineHeight: 1,
    fontWeight: "600",
  };

  const actionStyle = {
    height: "28px",
    padding: "0 9px",
    border:
      "1px solid #30363d",
    borderRadius: "4px",
    background: "#f0f6fc",
    color: "#f0f6fc",
    cursor: "pointer",
    fontSize: "9px",
  };

  return (
    <div
      style={{
        width: "100%",
        background: "#e9ecef",
        border:
          "1px solid #30363d",
        borderRadius: "5px",
        overflow: "hidden",
        color: "#f0f6fc",
        boxShadow:
          "0 3px 14px rgba(0,0,0,0.12)",
      }}
    >
      <div
        style={{
          height: "52px",
          padding: "0 17px",
          display: "flex",
          alignItems: "center",
          justifyContent:
            "space-between",
          background:
            "#f0f6fc",
          borderBottom:
            "1px solid #30363d",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
          }}
        >
          <div
            style={{
              width: "29px",
              height: "29px",
              display: "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              borderRadius: "5px",
              background:
                "linear-gradient(135deg,#5865f2,#5865f2)",
              color: "#f0f6fc",
              fontSize: "13px",
              fontWeight: "700",
            }}
          >
            ◆
          </div>

          <span
            style={{
              fontSize: "13px",
              fontWeight: "700",
            }}
          >
            DevMeet
          </span>

          <span
            style={{
              color: "#8b949e",
            }}
          >
            /
          </span>

          <span
            style={{
              color: "#8b949e",
              fontSize: "12px",
            }}
          >
            Tableau blanc
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: "#3fb950",
            fontSize: "9px",
            fontWeight: "600",
          }}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius:
                "50%",
              background:
                "#3fb950",
            }}
          />
          Synchronisé
        </div>
      </div>

      <div
        style={{
          height: "35px",
          display: "flex",
          alignItems: "center",
          gap: "20px",
          padding: "0 17px",
          background:
            "#f0f6fc",
          borderBottom:
            "1px solid #30363d",
          fontSize: "10px",
          color: "#f0f6fc",
        }}
      >
        <span
          style={{
            cursor: "pointer",
          }}
        >
          Accueil
        </span>

        <span
          style={{
            cursor: "pointer",
          }}
        >
          Affichage
        </span>
      </div>

      <div
        style={{
          padding:
            "10px 12px",
          background:
            "#eceff2",
          borderBottom:
            "1px solid #30363d",
          overflowX:
            "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems:
              "stretch",
            gap: "8px",
            minWidth:
              "980px",
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "4px",
              gap: "2px",
              border:
                "1px solid #30363d",
              borderRadius: "5px",
              background:
                "#f8f9fa",
            }}
          >
            {[
              [
                "select",
                <MousePointer2 size={16} />,
                "Sélection",
              ],
              [
                "draw",
                <Pencil size={16} />,
                "Crayon",
              ],
              [
                "eraser",
                <Eraser size={16} />,
                "Gomme",
              ],
              [
                "fill",
                <PaintBucket size={16} />,
                "Remplissage",
              ],
              [
                "picker",
                <Pipette size={16} />,
                "Pipette",
              ],
              [
                "text",
                <Type size={16} />,
                "Texte",
              ],
              [
                "note",
                <StickyNote size={16} />,
                "Note",
              ],
            ].map(
              ([tool, icon, label]) => (
                <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                  key={tool}
                  type="button"
                  onClick={() => {
                    if (
                      tool ===
                      "eraser"
                    ) {
                      eraserTool();
                    } else if (
                      tool ===
                      "fill"
                    ) {
                      fillTool();
                    } else if (
                      tool ===
                      "picker"
                    ) {
                      pickerTool();
                    } else {
                      setTool(tool);
                    }
                  }}
                  style={topToolStyle(
                    tool
                  )}
                >
                  <span
                    style={
                      iconStyle
                    }
                  >
                    {icon}
                  </span>

                  <span>
                    {label}
                  </span>
                </motion.button>
              )
            )}
          </div>

          <div
            style={{
              padding:
                "0 9px",
              borderLeft:
                "1px solid #30363d",
              borderRight:
                "1px solid #30363d",
            }}
          >
            <div
              style={{
                marginBottom:
                  "5px",
                color:
                  "#8b949e",
                fontSize:
                  "8px",
                fontWeight:
                  "600",
              }}
            >
              FORMES
            </div>

            <div
              style={{
                display:
                  "flex",
                flexWrap:
                  "wrap",
                width:
                  "220px",
                gap:
                  "3px",
              }}
            >
              {[
                [
                  "rectangle",
                  <Square size={15} />,
                  "Rectangle",
                ],
                [
                  "circle",
                  <CircleIcon size={15} />,
                  "Cercle",
                ],
                [
                  "triangle",
                  <TriangleIcon size={15} />,
                  "Triangle",
                ],
                [
                  "ellipse",
                  <CircleIcon size={15} />,
                  "Ellipse",
                ],
                [
                  "diamond",
                  <Diamond size={15} />,
                  "Losange",
                ],
                [
                  "pentagon",
                  <Pentagon size={15} />,
                  "Pentagone",
                ],
                [
                  "hexagon",
                  <Hexagon size={15} />,
                  "Hexagone",
                ],
                [
                  "star",
                  <Star size={15} />,
                  "Étoile",
                ],
              ].map(
                ([tool, icon, title]) => (
                  <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                    key={tool}
                    type="button"
                    title={title}
                    onClick={() =>
                      chooseShape(
                        tool
                      )
                    }
                    style={{
                      width:
                        "49px",
                      height:
                        "27px",
                      border:
                        "1px solid #30363d",
                      borderRadius:
                        "4px",
                      background:
                        "#f0f6fc",
                      color:
                        "#f0f6fc",
                      cursor:
                        "pointer",
                      fontSize:
                        "14px",
                    }}
                  >
                    {icon}
                  </motion.button>
                )
              )}
            </div>

            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
              type="button"
              onClick={() =>
                setTool(
                  activeTool ===
                    "line"
                    ? "select"
                    : "line"
                )
              }
              style={{
                marginTop:
                  "4px",
                width:
                  "49px",
                height:
                  "25px",
                border:
                  activeTool ===
                  "line"
                    ? "1px solid #5865f2"
                    : "1px solid #30363d",
                borderRadius:
                  "4px",
                background:
                  activeTool ===
                  "line"
                    ? "#343b4a"
                    : "#f0f6fc",
                color:
                  "#f0f6fc",
                cursor:
                  "pointer",
                fontSize:
                  "14px",
              }}
            >
              <Minus size={15} />
            </motion.button>

            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
              type="button"
              onClick={() =>
                setTool(
                  activeTool ===
                    "arrow"
                    ? "select"
                    : "arrow"
                )
              }
              style={{
                marginTop:
                  "4px",
                marginLeft:
                  "3px",
                width:
                  "49px",
                height:
                  "25px",
                border:
                  activeTool ===
                  "arrow"
                    ? "1px solid #5865f2"
                    : "1px solid #30363d",
                borderRadius:
                  "4px",
                background:
                  activeTool ===
                  "arrow"
                    ? "#343b4a"
                    : "#f0f6fc",
                color:
                  "#f0f6fc",
                cursor:
                  "pointer",
                fontSize:
                  "14px",
              }}
            >
              <MoveRight size={15} />
            </motion.button>
          </div>

          <div
            style={{
              padding:
                "0 9px",
              borderRight:
                "1px solid #30363d",
            }}
          >
            <div
              style={{
                marginBottom:
                  "5px",
                color:
                  "#8b949e",
                fontSize:
                  "8px",
                fontWeight:
                  "600",
              }}
            >
              TAILLE
            </div>

            <div
              style={{
                display:
                  "flex",
                flexDirection:
                  "column",
                gap:
                  "2px",
              }}
            >
              {[1, 2, 4, 6, 8].map(
                (size) => (
                  <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                    key={size}
                    type="button"
                    onClick={() =>
                      chooseStrokeWidth(
                        size
                      )
                    }
                    style={{
                      width:
                        "70px",
                      height:
                        "20px",
                      border:
                        strokeWidth ===
                        size
                          ? "1px solid #5865f2"
                          : "1px solid transparent",
                      borderRadius:
                        "3px",
                      background:
                        strokeWidth ===
                        size
                          ? "#343b4a"
                          : "transparent",
                      color:
                        "#424851",
                      cursor:
                        "pointer",
                      fontSize:
                        "9px",
                      textAlign:
                        "left",
                    }}
                  >
                    {"━".repeat(
                      Math.min(
                        size,
                        5
                      )
                    )}{" "}
                    {size}px
                  </motion.button>
                )
              )}
            </div>
          </div>

          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            style={{
              padding:
                "0 9px",
              borderRight:
                "1px solid #30363d",
            }}
          >
            <div
              style={{
                marginBottom:
                  "5px",
                color:
                  "#8b949e",
                fontSize:
                  "8px",
                fontWeight:
                  "600",
              }}
            >
              COULEURS
            </div>

            <div
              style={{
                display:
                  "flex",
                alignItems:
                  "center",
                gap:
                  "8px",
                marginBottom:
                  "6px",
              }}
            >
              <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                type="button"
                onClick={() =>
                  setPaletteTarget(
                    "primary"
                  )
                }
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap:
                    "4px",
                  border:
                    paletteTarget ===
                    "primary"
                      ? "1px solid #5865f2"
                      : "1px solid transparent",
                  borderRadius:
                    "3px",
                  background:
                    "transparent",
                  cursor:
                    "pointer",
                  padding:
                    "2px",
                }}
              >
                <span
                  style={{
                    fontSize:
                      "8px",
                    color:
                      "#59616b",
                  }}
                >
                  Couleur 1
                </span>

                <span
                  style={{
                    width:
                      "22px",
                    height:
                      "22px",
                    border:
                      "1px solid #7d838b",
                    borderRadius:
                      "3px",
                    background:
                      primaryColor,
                  }}
                />
              </motion.button>

              <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                type="button"
                onClick={() =>
                  setPaletteTarget(
                    "secondary"
                  )
                }
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap:
                    "4px",
                  border:
                    paletteTarget ===
                    "secondary"
                      ? "1px solid #5865f2"
                      : "1px solid transparent",
                  borderRadius:
                    "3px",
                  background:
                    "transparent",
                  cursor:
                    "pointer",
                  padding:
                    "2px",
                }}
              >
                <span
                  style={{
                    fontSize:
                      "8px",
                    color:
                      "#59616b",
                  }}
                >
                  Couleur 2
                </span>

                <span
                  style={{
                    width:
                      "22px",
                    height:
                      "22px",
                    border:
                      "1px solid #7d838b",
                    borderRadius:
                      "3px",
                    background:
                      secondaryColor,
                  }}
                />
              </motion.button>
            </div>

            <div
              style={{
                display:
                  "grid",
                gridTemplateColumns:
                  "repeat(10, 15px)",
                gap:
                  "3px",
              }}
            >
              {palette.map(
                (color) => (
                  <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                    key={color}
                    type="button"
                    onClick={() =>
                      choosePaletteColor(
                        color
                      )
                    }
                    style={{
                      width:
                        "15px",
                      height:
                        "15px",
                      padding:
                        0,
                      border:
                        "1px solid #b8bdc4",
                      borderRadius:
                        "50%",
                      background:
                        color,
                      cursor:
                        "pointer",
                    }}
                  />
                )
              )}
            </div>
          </motion.div>

          <div
            style={{
              minWidth:
                "230px",
            }}
          >
            <div
              style={{
                marginBottom:
                  "5px",
                color:
                  "#8b949e",
                fontSize:
                  "8px",
                fontWeight:
                  "600",
              }}
            >
              CONTOUR / REMPLISSAGE
            </div>

            <div
              style={{
                display:
                  "flex",
                flexWrap:
                  "wrap",
                alignItems:
                  "center",
                gap:
                  "8px",
              }}
            >
              <label
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap:
                    "4px",
                  fontSize:
                    "8px",
                  color:
                    "#59616b",
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    transparentStroke
                  }
                  onChange={(
                    event
                  ) =>
                    applyStrokeSetting(
                      event
                        .target
                        .checked
                    )
                  }
                />
                Contour transparent
              </label>

              <label
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap:
                    "4px",
                  fontSize:
                    "8px",
                  color:
                    "#59616b",
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    transparentFill
                  }
                  onChange={(
                    event
                  ) =>
                    applyFillSetting(
                      event
                        .target
                        .checked
                    )
                  }
                />
                Remplissage transparent
              </label>

              <label
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap:
                    "4px",
                  fontSize:
                    "8px",
                  color:
                    "#59616b",
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    dashedStroke
                  }
                  onChange={(
                    event
                  ) =>
                    applyDashedSetting(
                      event
                        .target
                        .checked
                    )
                  }
                />
                Pointillés
              </label>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display:
            "flex",
          alignItems:
            "center",
          gap:
            "5px",
          padding:
            "7px 12px",
          background:
            "#f5f6f7",
          borderBottom:
            "1px solid #30363d",
        }}
      >
        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          type="button"
          onClick={undo}
          style={actionStyle}
        >
          <Undo2 size={15} /> Annuler
        </motion.button>

        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          type="button"
          onClick={redo}
          style={actionStyle}
        >
          <Redo2 size={15} /> Rétablir
        </motion.button>

        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          type="button"
          onClick={copySelected}
          style={actionStyle}
        >
          <Copy size={15} /> Copier
        </motion.button>

        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          type="button"
          onClick={pasteSelected}
          style={actionStyle}
        >
          <ClipboardPaste size={15} /> Coller
        </motion.button>

        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          type="button"
          onClick={deleteSelected}
          style={actionStyle}
        >
          <Trash2 size={15} /> Supprimer
        </motion.button>

        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          type="button"
          onClick={exportPNG}
          style={actionStyle}
        >
          <Download size={15} /> PNG
        </motion.button>

        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
          type="button"
          onClick={exportJPEG}
          style={actionStyle}
        >
          <ImageDown size={15} /> JPEG
        </motion.button>

        <div
          style={{
            marginLeft:
              "auto",
            display:
              "flex",
            alignItems:
              "center",
            gap:
              "5px",
          }}
        >
          <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
            type="button"
            onClick={() =>
              changeZoom(
                zoom - 0.1
              )
            }
            style={actionStyle}
          >
            <ZoomOut size={15} />
          </motion.button>

          <span
            style={{
              width:
                "45px",
              textAlign:
                "center",
              color:
                "#59616b",
              fontSize:
                "9px",
            }}
          >
            {Math.round(
              zoom * 100
            )}
            %
          </span>

          <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
            type="button"
            onClick={() =>
              changeZoom(
                zoom + 0.1
              )
            }
            style={actionStyle}
          >
            <ZoomIn size={15} />
          </motion.button>
        </div>
      </div>

      <div
        style={{
          padding:
            "18px",
          minHeight:
            "720px",
          background:
            "#dfe2e6",
          overflow:
            "auto",
        }}
      >
        <div
          style={{
            position:
              "relative",
            width:
              "1100px",
            height:
              "650px",
            margin:
              "0 auto",
            background:
              "#f0f6fc",
            border:
              "1px solid #b7bdc5",
            boxShadow:
              "0 5px 16px rgba(0,0,0,0.16)",
            overflow:
              "hidden",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              display:
                "block",
            }}
          />

          <AnimatePresence>
          {Object.entries(
            remoteCursors
          ).map(
            ([socketId, cursor]) => (
              <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                key={socketId}
                style={{
                  position:
                    "absolute",
                  left:
                    cursor.x *
                    zoom,
                  top:
                    cursor.y *
                    zoom,
                  width:
                    "10px",
                  height:
                    "10px",
                  borderRadius:
                    "50%",
                  background:
                    "#f85149",
                  border:
                    "2px solid #f0f6fc",
                  pointerEvents:
                    "none",
                  transform:
                    "translate(-50%,-50%)",
                }}
              />
            )
          )}
          </AnimatePresence>
        </div>
      </div>

      <div
        style={{
          height:
            "33px",
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "space-between",
          padding:
            "0 13px",
          background:
            "#f4f5f6",
          borderTop:
            "1px solid #ccd1d6",
          color:
            "#5f6873",
          fontSize:
            "8px",
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap:
              "15px",
          }}
        >
          <span>
            DevMeet Whiteboard
          </span>

          <span>
            1100 × 650 px
          </span>

          <span>
            Outil :{" "}
            {activeTool}
          </span>
        </div>

        <span>
          {Math.round(
            zoom * 100
          )}
          %
        </span>
      </div>
    </div>
  );
}

export default Whiteboard;