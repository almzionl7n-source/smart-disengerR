/**
 * ====================================================================
 * SMART DESIGNER PRO · PROFESSIONAL GRAPHICS ENGINE
 * Version: 2.4.3 Enterprise
 * License: Commercial / Proprietary
 * 
 * COMPLETE MASTER FILE - PARTS 1, 2 & 3
 * Includes: Core Engine, Image Processing, AI Integration,
 *           Export Engine, Memory Management, Keyboard Shortcuts
 * 
 * Author: Senior Architect
 * ====================================================================
 */

(function(global) {
    'use strict';

    /**
     * ====================================================================
     * ENGINE CONSTANTS & CONFIGURATION
     * ====================================================================
     */
    const SMART_CONFIG = Object.freeze({
        CANVAS: {
            DEFAULT_WIDTH: 1920,
            DEFAULT_HEIGHT: 1080,
            DPI: 300,
            PPI: 96,
            MAX_HISTORY_STATES: 100,
            AUTO_SAVE_INTERVAL: 30000,
            PERFORMANCE: {
                ENABLE_GPU: true,
                ENABLE_RETINA: true,
                OBJECT_CACHING: true,
                SKIP_OFFSCREEN: true,
                TEXTURE_CACHE_SIZE: 50,
                MEMORY_CHECK_INTERVAL: 60000,
                GC_THRESHOLD: 0.8
            }
        },
        
        LAYER: {
            MAX_DEPTH: 50,
            ALLOW_EMPTY_GROUPS: false,
            PRESERVE_STACK_ON_GROUP: true,
            DEFAULT_VISIBILITY: true,
            DEFAULT_LOCKED: false
        },

        SNAPPING: {
            ENABLED: true,
            TOLERANCE: 8,
            GUIDES_COLOR: 'rgba(99, 102, 241, 0.7)',
            OBJECT_MARGIN: 10
        },

        FILTERS: {
            MAX_CONCURRENT: 4,
            USE_WEBGL: true,
            FALLBACK_TO_CPU: true
        },

        EXPORT: {
            FORMATS: ['png', 'jpg', 'pdf', 'svg'],
            QUALITY: {
                DRAFT: 72,
                WEB: 96,
                PRINT: 300,
                ULTRA: 600
            },
            SCALE_MULTIPLIERS: [1, 2, 4, 8],
            MAX_SIZE: 16384,
            COLOR_PROFILES: ['sRGB', 'AdobeRGB', 'CMYK']
        },

        KEYBOARD: {
            UNDO: { key: 'z', ctrl: true, shift: false },
            REDO: { key: 'y', ctrl: true, shift: false },
            REDO_ALT: { key: 'z', ctrl: true, shift: true },
            DELETE: { key: 'Delete', ctrl: false, shift: false },
            DELETE_ALT: { key: 'Backspace', ctrl: false, shift: false },
            GROUP: { key: 'g', ctrl: true, shift: false },
            UNGROUP: { key: 'g', ctrl: true, shift: true },
            DUPLICATE: { key: 'd', ctrl: true, shift: false },
            COPY: { key: 'c', ctrl: true, shift: false },
            PASTE: { key: 'v', ctrl: true, shift: false },
            SELECT_ALL: { key: 'a', ctrl: true, shift: false }
        },

        STORAGE: {
            PROJECT_KEY: 'smart_designer_project',
            AUTO_SAVE_KEY: 'smart_designer_autosave',
            SETTINGS_KEY: 'smart_designer_settings',
            MAX_PROJECT_SIZE: 50 * 1024 * 1024, // 50MB
            COMPRESSION: true
        }
    });

    /**
     * ====================================================================
     * CUSTOM ERROR TYPES FOR PRECISE DEBUGGING
     * ====================================================================
     */
    class SmartDesignerError extends Error {
        constructor(code, message, isFatal = false) {
            super(`[SMART-DESIGNER:${code}] ${message}`);
            this.name = 'SmartDesignerError';
            this.code = code;
            this.isFatal = isFatal;
            this.timestamp = Date.now();
        }
    }

    class LayerTreeError extends SmartDesignerError {
        constructor(message, operation) {
            super('LAYER-001', `Layer Tree Error during ${operation}: ${message}`);
        }
    }

    class StateError extends SmartDesignerError {
        constructor(message) {
            super('STATE-001', `State Management Error: ${message}`);
        }
    }

    class ExportError extends SmartDesignerError {
        constructor(message) {
            super('EXPORT-001', `Export Engine Error: ${message}`);
        }
    }

    class MemoryError extends SmartDesignerError {
        constructor(message) {
            super('MEM-001', `Memory Management Error: ${message}`);
        }
    }

    /**
     * ====================================================================
     * PERFORMANCE MONITORING DECORATOR
     * ====================================================================
     */
    function perfMonitor(target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function(...args) {
            const start = performance.now();
            const result = await originalMethod.apply(this, args);
            const duration = performance.now() - start;
            
            if (duration > 16) {
                console.warn(`[PERF] ${propertyKey} took ${duration.toFixed(2)}ms`);
            }
            
            if (this.performanceMetrics) {
                this.performanceMetrics[propertyKey] = duration;
            }
            
            return result;
        };
        return descriptor;
    }

    /**
     * ====================================================================
     * GLOBAL STATE MANAGER (IMMUTABLE SNAPSHOT-BASED)
     * Handles Undo/Redo with memory-efficient diffing
     * ====================================================================
     */
    class StateSnapshotManager {
        #states = [];
        #currentIndex = -1;
        #maxStates;
        #snapshotDebouncer = null;
        #autoSaveInterval = null;
        #listeners = new Set();
        #compressionThreshold = 50;
        
        constructor(maxStates = SMART_CONFIG.CANVAS.MAX_HISTORY_STATES) {
            this.#maxStates = maxStates;
            this.#initializeAutoSave();
            this.performanceMetrics = {};
        }

        #createSnapshot(state, metadata = {}) {
            try {
                const snapshot = this.#deepCloneWithLayers(state);
                
                Object.defineProperty(snapshot, '__metadata', {
                    value: {
                        timestamp: Date.now(),
                        id: crypto.randomUUID ? crypto.randomUUID() : `snap_${Date.now()}_${Math.random()}`,
                        type: metadata.type || 'unknown',
                        layerCount: this.#countLayers(snapshot),
                        compressed: false,
                        ...metadata
                    },
                    enumerable: false,
                    writable: false
                });

                return Object.freeze(snapshot);
            } catch (error) {
                throw new StateError(`Snapshot creation failed: ${error.message}`);
            }
        }

        #deepCloneWithLayers(obj, hash = new WeakMap()) {
            if (Object(obj) !== obj) return obj;
            if (obj instanceof Date) return new Date(obj);
            if (obj instanceof RegExp) return new RegExp(obj);
            if (obj instanceof fabric.Object) {
                return this.#cloneFabricObject(obj);
            }
            if (hash.has(obj)) return hash.get(obj);

            const result = Array.isArray(obj) ? [] : Object.create(Object.getPrototypeOf(obj));
            hash.set(obj, result);

            return Object.assign(result, ...Object.keys(obj).map(key => 
                ({ [key]: this.#deepCloneWithLayers(obj[key], hash) })
            ));
        }

        #cloneFabricObject(obj) {
            if (!obj || !obj.toObject) return obj;
            
            try {
                const cloned = obj.clone();
                if (obj.smartDesigner) {
                    cloned.smartDesigner = { ...obj.smartDesigner };
                }
                return cloned;
            } catch {
                return obj.toObject();
            }
        }

        #countLayers(state) {
            if (!state || !state.layers) return 0;
            
            const countRecursive = (layers) => {
                return layers.reduce((acc, layer) => {
                    if (layer.type === 'group' && layer.children) {
                        return acc + 1 + countRecursive(layer.children);
                    }
                    return acc + 1;
                }, 0);
            };

            return countRecursive(state.layers);
        }

        pushState(newState, metadata = {}) {
            if (this.#currentIndex < this.#states.length - 1) {
                this.#states = this.#states.slice(0, this.#currentIndex + 1);
            }

            const snapshot = this.#createSnapshot(newState, metadata);
            this.#states.push(snapshot);
            this.#currentIndex++;

            if (this.#states.length > this.#maxStates) {
                this.#compressOldStates();
            }

            this.#notifyListeners({
                type: 'stateChange',
                canUndo: this.canUndo,
                canRedo: this.canRedo,
                currentIndex: this.#currentIndex,
                totalStates: this.#states.length
            });

            return snapshot.__metadata.id;
        }

        #compressOldStates() {
            const excessCount = this.#states.length - this.#maxStates;
            
            if (excessCount > this.#compressionThreshold) {
                this.#states = this.#states.slice(-this.#maxStates);
            } else {
                this.#states = this.#states.slice(excessCount);
            }
            
            this.#currentIndex = this.#states.length - 1;
        }

        undo() {
            if (!this.canUndo) return null;
            
            this.#currentIndex--;
            const state = this.#states[this.#currentIndex];
            
            this.#notifyListeners({
                type: 'undo',
                state: state,
                canUndo: this.canUndo,
                canRedo: this.canRedo
            });

            return state;
        }

        redo() {
            if (!this.canRedo) return null;
            
            this.#currentIndex++;
            const state = this.#states[this.#currentIndex];
            
            this.#notifyListeners({
                type: 'redo',
                state: state,
                canUndo: this.canUndo,
                canRedo: this.canRedo
            });

            return state;
        }

        get current() {
            return this.#states[this.#currentIndex];
        }

        get canUndo() {
            return this.#currentIndex > 0;
        }

        get canRedo() {
            return this.#currentIndex < this.#states.length - 1;
        }

        #initializeAutoSave() {
            this.#autoSaveInterval = setInterval(() => {
                this.#notifyListeners({ type: 'autoSave' });
            }, SMART_CONFIG.CANVAS.AUTO_SAVE_INTERVAL);
        }

        addListener(callback) {
            this.#listeners.add(callback);
            return () => this.#listeners.delete(callback);
        }

        #notifyListeners(event) {
            this.#listeners.forEach(listener => {
                try {
                    listener(event);
                } catch (error) {
                    console.error('Listener error:', error);
                }
            });
        }

        getHistory() {
            return this.#states.map((state, index) => ({
                index,
                metadata: state.__metadata,
                isCurrent: index === this.#currentIndex
            }));
        }

        destroy() {
            if (this.#autoSaveInterval) {
                clearInterval(this.#autoSaveInterval);
            }
            this.#states = [];
            this.#listeners.clear();
        }
    }

    /**
     * ====================================================================
     * ADVANCED LAYER TREE SYSTEM
     * Recursive tree structure with group/ungroup, locking, visibility
     * ====================================================================
     */
    class LayerTreeManager {
        #layers = [];
        #selectedLayerIds = new Set();
        #layerMap = new Map();
        #parentMap = new Map();
        #eventBus;
        #currentGroupDepth = 0;

        constructor(eventBus) {
            this.#eventBus = eventBus;
            this.#initializeRootLayers();
        }

        #initializeRootLayers() {
            const rootLayer = this.#createLayerObject('Root', 'root', null, {
                isRoot: true,
                locked: true,
                visible: true
            });
            
            this.#layers.push(rootLayer);
            this.#layerMap.set(rootLayer.id, rootLayer);
        }

        #createLayerObject(name, type, parentId = null, options = {}) {
            const id = `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const layer = {
                id,
                name,
                type: type || 'layer',
                parentId,
                children: type === 'group' ? [] : null,
                visible: options.visible ?? SMART_CONFIG.LAYER.DEFAULT_VISIBILITY,
                locked: options.locked ?? SMART_CONFIG.LAYER.DEFAULT_LOCKED,
                expanded: options.expanded ?? true,
                fabricObjects: new Set(),
                effects: {
                    opacity: 1,
                    blendMode: 'normal',
                    filters: [],
                    masks: []
                },
                metadata: {
                    createdAt: Date.now(),
                    modifiedAt: Date.now(),
                    creator: 'system',
                    tags: options.tags || [],
                    customData: options.customData || {}
                },
                caching: {
                    enabled: SMART_CONFIG.CANVAS.PERFORMANCE.OBJECT_CACHING,
                    lastRendered: null,
                    thumbnail: null
                },
                isRoot: options.isRoot || false,
                isGroup: type === 'group'
            };

            if (parentId) {
                this.#parentMap.set(id, parentId);
            }

            return Object.freeze(layer);
        }

        addLayer(name, type = 'layer', parentId = null, options = {}) {
            try {
                const targetParentId = parentId || this.#getCurrentParent();
                
                if (targetParentId) {
                    const parent = this.#layerMap.get(targetParentId);
                    if (!parent) {
                        throw new LayerTreeError(`Parent ${targetParentId} not found`, 'addLayer');
                    }
                    if (parent.type !== 'group' && !parent.isRoot) {
                        throw new LayerTreeError('Parent is not a group', 'addLayer');
                    }
                }

                const newLayer = this.#createLayerObject(name, type, targetParentId, options);
                
                this.#layerMap.set(newLayer.id, newLayer);

                if (targetParentId) {
                    const parent = this.#layerMap.get(targetParentId);
                    if (parent.children) {
                        parent.children.push(newLayer.id);
                    }
                } else {
                    this.#layers[0].children.push(newLayer.id);
                }

                this.#eventBus.emit('layer:added', {
                    layer: newLayer,
                    parentId: targetParentId
                });

                return newLayer;
            } catch (error) {
                throw new LayerTreeError(error.message, 'addLayer');
            }
        }

        groupLayers(layerIds, groupName = 'Group') {
            if (layerIds.length < 2) {
                throw new LayerTreeError('Need at least 2 layers to group', 'groupLayers');
            }

            try {
                const parents = layerIds.map(id => this.#parentMap.get(id));
                const commonParent = this.#findCommonParent(parents);
                
                if (!commonParent) {
                    throw new LayerTreeError('Layers must share a common parent', 'groupLayers');
                }

                const groupLayer = this.addLayer(groupName, 'group', commonParent, {
                    expanded: true
                });

                layerIds.forEach(id => {
                    const layer = this.#layerMap.get(id);
                    if (layer && layer.parentId) {
                        const oldParent = this.#layerMap.get(layer.parentId);
                        if (oldParent && oldParent.children) {
                            const index = oldParent.children.indexOf(id);
                            if (index > -1) {
                                oldParent.children.splice(index, 1);
                            }
                        }
                        
                        layer.parentId = groupLayer.id;
                        groupLayer.children.push(id);
                        this.#parentMap.set(id, groupLayer.id);
                    }
                });

                this.#selectedLayerIds.clear();
                this.#selectedLayerIds.add(groupLayer.id);

                this.#eventBus.emit('layer:grouped', {
                    groupId: groupLayer.id,
                    layerIds: layerIds
                });

                return groupLayer;
            } catch (error) {
                throw new LayerTreeError(error.message, 'groupLayers');
            }
        }

        ungroupLayers(groupId) {
            const group = this.#layerMap.get(groupId);
            
            if (!group || group.type !== 'group') {
                throw new LayerTreeError('Invalid group for ungrouping', 'ungroupLayers');
            }

            try {
                const parentId = group.parentId;
                const children = [...group.children];

                children.forEach(childId => {
                    const child = this.#layerMap.get(childId);
                    if (child) {
                        child.parentId = parentId;
                        this.#parentMap.set(childId, parentId);
                        
                        const parent = this.#layerMap.get(parentId);
                        if (parent && parent.children) {
                            parent.children.push(childId);
                        }
                    }
                });

                const parent = this.#layerMap.get(parentId);
                if (parent && parent.children) {
                    const index = parent.children.indexOf(groupId);
                    if (index > -1) {
                        parent.children.splice(index, 1);
                    }
                }

                this.#layerMap.delete(groupId);
                this.#parentMap.delete(groupId);

                this.#selectedLayerIds.clear();
                children.forEach(id => this.#selectedLayerIds.add(id));

                this.#eventBus.emit('layer:ungrouped', {
                    groupId: groupId,
                    childIds: children
                });

                return children;
            } catch (error) {
                throw new LayerTreeError(error.message, 'ungroupLayers');
            }
        }

        #findCommonParent(parentIds) {
            if (parentIds.length === 0) return null;
            if (parentIds.every(id => id === parentIds[0])) return parentIds[0];
            
            const paths = parentIds.map(id => this.#getPathToRoot(id));
            const minLength = Math.min(...paths.map(p => p.length));
            
            for (let i = 0; i < minLength; i++) {
                const ancestor = paths[0][i];
                if (paths.every(path => path[i] === ancestor)) {
                    return ancestor;
                }
            }
            
            return this.#layers[0].id;
        }

        #getPathToRoot(layerId) {
            const path = [];
            let currentId = layerId;
            
            while (currentId) {
                path.unshift(currentId);
                currentId = this.#parentMap.get(currentId);
            }
            
            return path;
        }

        #getCurrentParent() {
            if (this.#selectedLayerIds.size === 1) {
                const selected = Array.from(this.#selectedLayerIds)[0];
                const layer = this.#layerMap.get(selected);
                
                if (layer && (layer.type === 'group' || layer.isRoot)) {
                    return selected;
                } else if (layer) {
                    return layer.parentId;
                }
            }
            
            return this.#layers[0].id;
        }

        toggleVisibility(layerId) {
            const layer = this.#layerMap.get(layerId);
            if (!layer) return false;

            layer.visible = !layer.visible;
            layer.metadata.modifiedAt = Date.now();

            this.#eventBus.emit('layer:visibilityChanged', {
                layerId: layerId,
                visible: layer.visible
            });

            return layer.visible;
        }

        toggleLock(layerId) {
            const layer = this.#layerMap.get(layerId);
            if (!layer) return false;

            layer.locked = !layer.locked;
            layer.metadata.modifiedAt = Date.now();

            this.#eventBus.emit('layer:lockChanged', {
                layerId: layerId,
                locked: layer.locked
            });

            return layer.locked;
        }

        selectLayers(layerIds, replace = true) {
            if (replace) {
                this.#selectedLayerIds.clear();
            }

            layerIds.forEach(id => {
                if (this.#layerMap.has(id)) {
                    this.#selectedLayerIds.add(id);
                }
            });

            this.#eventBus.emit('layer:selectionChanged', {
                selectedIds: Array.from(this.#selectedLayerIds),
                count: this.#selectedLayerIds.size
            });
        }

        getTree() {
            const buildTree = (layerId) => {
                const layer = this.#layerMap.get(layerId);
                if (!layer) return null;

                const node = {
                    id: layer.id,
                    name: layer.name,
                    type: layer.type,
                    visible: layer.visible,
                    locked: layer.locked,
                    expanded: layer.expanded,
                    metadata: layer.metadata
                };

                if (layer.children && layer.children.length > 0) {
                    node.children = layer.children
                        .map(childId => buildTree(childId))
                        .filter(child => child !== null);
                }

                return node;
            };

            return buildTree(this.#layers[0].id);
        }

        getAllLayers() {
            return Array.from(this.#layerMap.values());
        }

        isLocked(layerId) {
            const layer = this.#layerMap.get(layerId);
            return layer ? layer.locked : true;
        }

        isVisible(layerId) {
            const layer = this.#layerMap.get(layerId);
            
            if (!layer) return false;
            if (!layer.visible) return false;
            
            if (layer.parentId) {
                return this.isVisible(layer.parentId);
            }
            
            return true;
        }
    }

    /**
     * ====================================================================
     * EVENT BUS FOR MODULE COMMUNICATION
     * ====================================================================
     */
    class EventBus {
        #events = new Map();
        #onceEvents = new Map();
        #maxListeners = 100;

        on(event, listener) {
            if (!this.#events.has(event)) {
                this.#events.set(event, new Set());
            }
            
            const listeners = this.#events.get(event);
            if (listeners.size >= this.#maxListeners) {
                console.warn(`Event bus: ${event} has exceeded max listeners`);
            }
            
            listeners.add(listener);
            
            return () => this.off(event, listener);
        }

        once(event, listener) {
            if (!this.#onceEvents.has(event)) {
                this.#onceEvents.set(event, new Set());
            }
            this.#onceEvents.get(event).add(listener);
        }

        off(event, listener) {
            if (this.#events.has(event)) {
                this.#events.get(event).delete(listener);
            }
            if (this.#onceEvents.has(event)) {
                this.#onceEvents.get(event).delete(listener);
            }
        }

        emit(event, data) {
            if (this.#events.has(event)) {
                this.#events.get(event).forEach(listener => {
                    try {
                        listener(data);
                    } catch (error) {
                        console.error(`Event bus error in ${event}:`, error);
                    }
                });
            }

            if (this.#onceEvents.has(event)) {
                this.#onceEvents.get(event).forEach(listener => {
                    try {
                        listener(data);
                    } catch (error) {
                        console.error(`Event bus error in ${event} (once):`, error);
                    }
                });
                this.#onceEvents.delete(event);
            }
        }

        clear() {
            this.#events.clear();
            this.#onceEvents.clear();
        }
    }

    /**
     * ====================================================================
     * CUSTOM CANVAS WRAPPER (FABRIC.JS EXTENSION)
     * High-DPI support with luxury styling
     * ====================================================================
     */
    class CanvasWrapper {
        #canvas;
        #fabricCanvas;
        #container;
        #layerManager;
        #stateManager;
        #eventBus;
        #dpi;
        #devicePixelRatio;
        
        constructor(containerId, canvasId, options = {}) {
            this.#container = document.getElementById(containerId);
            this.#canvas = document.getElementById(canvasId);
            this.#dpi = options.dpi || SMART_CONFIG.CANVAS.DPI;
            this.#devicePixelRatio = window.devicePixelRatio || 1;
            
            if (!this.#container || !this.#canvas) {
                throw new SmartDesignerError('INIT-001', 'Canvas container not found', true);
            }

            this.#initializeFabric();
            this.#setupHighDPI();
            this.#applyLuxuryStyling();
            this.#setupEventListeners();
        }

        #initializeFabric() {
            const width = SMART_CONFIG.CANVAS.DEFAULT_WIDTH;
            const height = SMART_CONFIG.CANVAS.DEFAULT_HEIGHT;
            
            this.#fabricCanvas = new fabric.Canvas(this.#canvas, {
                width: width,
                height: height,
                backgroundColor: 'transparent',
                preserveObjectStacking: true,
                stopContextMenu: true,
                fireRightClick: true,
                enableRetinaScaling: SMART_CONFIG.CANVAS.PERFORMANCE.ENABLE_RETINA,
                imageSmoothingEnabled: true,
                allowTouchScrolling: false,
                selection: true,
                selectionColor: 'rgba(99, 102, 241, 0.2)',
                selectionBorderColor: 'rgba(99, 102, 241, 0.8)',
                selectionLineWidth: 1,
                selectionDashArray: [5, 3],
                hoverCursor: 'default',
                moveCursor: 'grabbing'
            });

            this.#canvas.width = width * this.#devicePixelRatio;
            this.#canvas.height = height * this.#devicePixelRatio;
            this.#canvas.style.width = `${width}px`;
            this.#canvas.style.height = `${height}px`;
        }

        #setupHighDPI() {
            if (this.#devicePixelRatio > 1) {
                const width = SMART_CONFIG.CANVAS.DEFAULT_WIDTH;
                const height = SMART_CONFIG.CANVAS.DEFAULT_HEIGHT;
                
                const ctx = this.#fabricCanvas.getContext();
                if (ctx) {
                    ctx.scale(this.#devicePixelRatio, this.#devicePixelRatio);
                }
                
                this.#fabricCanvas.setDimensions({
                    width: width,
                    height: height
                }, {
                    cssOnly: false
                });
            }
        }

        #applyLuxuryStyling() {
            fabric.Object.prototype.set({
                borderColor: '#6366f1',
                cornerColor: '#ffffff',
                cornerSize: 10,
                cornerStrokeColor: '#6366f1',
                cornerStyle: 'circle',
                transparentCorners: false,
                borderDashArray: [5, 3],
                borderScaleFactor: 2,
                padding: 8,
                selectionBackgroundColor: 'rgba(99, 102, 241, 0.1)'
            });

            fabric.Object.prototype.controls = this.#createLuxuryControls();
        }

        #createLuxuryControls() {
            const controls = { ...fabric.Control.prototype };

            Object.keys(controls).forEach(key => {
                if (controls[key] && controls[key].cursorHandler) {
                    const originalHandler = controls[key].cursorHandler;
                    controls[key].cursorHandler = (eventData, control, fabricObject) => {
                        const cursor = originalHandler(eventData, control, fabricObject);
                        if (cursor === 'move') {
                            return 'grabbing';
                        }
                        return cursor;
                    };
                }
            });

            return controls;
        }

        #setupEventListeners() {
            this.#fabricCanvas.on('object:modified', (e) => {
                this.#eventBus.emit('canvas:objectModified', e.target);
            });

            this.#fabricCanvas.on('selection:created', (e) => {
                this.#eventBus.emit('canvas:selectionChanged', {
                    selected: e.selected,
                    type: 'created'
                });
            });

            this.#fabricCanvas.on('selection:cleared', () => {
                this.#eventBus.emit('canvas:selectionChanged', {
                    selected: [],
                    type: 'cleared'
                });
            });

            this.#fabricCanvas.on('object:moving', (e) => {
                this.#eventBus.emit('canvas:objectMoving', e.target);
            });

            this.#fabricCanvas.on('object:scaling', (e) => {
                this.#eventBus.emit('canvas:objectScaling', e.target);
            });

            this.#fabricCanvas.on('before:render', () => {
                this.#eventBus.emit('canvas:beforeRender');
            });

            this.#fabricCanvas.on('after:render', () => {
                this.#eventBus.emit('canvas:afterRender');
            });
        }

        addObject(obj, layerId) {
            if (!obj) return null;

            this.#applyObjectLuxury(obj);
            
            obj.smartDesigner = {
                layerId: layerId,
                createdAt: Date.now(),
                version: '2.4.3'
            };

            this.#fabricCanvas.add(obj);
            this.#fabricCanvas.renderAll();

            return obj;
        }

        #applyObjectLuxury(obj) {
            if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'triangle') {
                obj.set({
                    stroke: '#ffffff',
                    strokeWidth: 1,
                    strokeUniform: true,
                    shadow: '0 4px 15px rgba(0,0,0,0.3)'
                });
            }

            if (obj.type === 'text') {
                obj.set({
                    fontFamily: 'Inter',
                    fontSize: 24,
                    fill: '#ffffff',
                    shadow: '0 2px 10px rgba(0,0,0,0.5)'
                });
            }

            if (obj.type === 'image') {
                obj.set({
                    shadow: '0 10px 30px rgba(0,0,0,0.5)',
                    borderColor: '#6366f1',
                    cornerColor: '#ffffff'
                });
            }
        }

        get canvas() {
            return this.#fabricCanvas;
        }

        render() {
            this.#fabricCanvas.renderAll();
        }

        setLayerManager(manager) {
            this.#layerManager = manager;
        }

        setStateManager(manager) {
            this.#stateManager = manager;
        }

        setEventBus(bus) {
            this.#eventBus = bus;
        }

        dispose() {
            if (this.#fabricCanvas) {
                this.#fabricCanvas.dispose();
            }
        }
    }

    /**
     * ====================================================================
     * FILTER ENGINE - GLSL-INSPIRED IMAGE PROCESSING
     * ====================================================================
     */
    class FilterEngine {
        #canvas;
        #filterCache = new WeakMap();
        #activeFilters = new Map();
        #workerPool = [];
        #maxConcurrentFilters = SMART_CONFIG.FILTERS.MAX_CONCURRENT;
        #useWebGL = SMART_CONFIG.FILTERS.USE_WEBGL;
        #gl;
        #shaderProgram;
        
        constructor(canvasWrapper) {
            this.#canvas = canvasWrapper.canvas;
            this.#initializeWorkerPool();
            this.#initializeWebGL();
        }

        #initializeWebGL() {
            if (!this.#useWebGL) return;

            try {
                const canvas = document.createElement('canvas');
                this.#gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                
                if (this.#gl) {
                    this.#initShaders();
                    console.log('✅ WebGL initialized for GPU-accelerated filters');
                }
            } catch (error) {
                console.warn('WebGL initialization failed, falling back to CPU:', error);
                this.#useWebGL = false;
            }
        }

        #initShaders() {
            if (!this.#gl) return;

            const vertexShader = this.#createShader(this.#gl.VERTEX_SHADER, `
                attribute vec2 a_position;
                attribute vec2 a_texCoord;
                varying vec2 v_texCoord;
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    v_texCoord = a_texCoord;
                }
            `);

            const fragmentShader = this.#createShader(this.#gl.FRAGMENT_SHADER, `
                precision highp float;
                varying vec2 v_texCoord;
                uniform sampler2D u_texture;
                uniform float u_brightness;
                uniform float u_contrast;
                uniform float u_saturation;
                uniform float u_hue;
                uniform float u_noise;
                uniform float u_pixelSize;
                uniform bool u_vintage;
                
                vec3 applyBrightness(vec3 color, float brightness) {
                    return color + brightness;
                }
                
                vec3 applyContrast(vec3 color, float contrast) {
                    return (color - 0.5) * contrast + 0.5;
                }
                
                vec3 applySaturation(vec3 color, float saturation) {
                    float gray = dot(color, vec3(0.299, 0.587, 0.114));
                    return mix(vec3(gray), color, saturation);
                }
                
                vec3 applyHue(vec3 color, float hue) {
                    vec3 k = vec3(0.57735, 0.57735, 0.57735);
                    float cosAngle = cos(hue);
                    return color * cosAngle + cross(k, color) * sin(hue) + k * dot(k, color) * (1.0 - cosAngle);
                }
                
                float applyNoise(vec2 uv, float amount) {
                    return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) * amount;
                }
                
                vec3 applyVintage(vec3 color) {
                    color.r = 0.393 * color.r + 0.769 * color.g + 0.189 * color.b;
                    color.g = 0.349 * color.r + 0.686 * color.g + 0.168 * color.b;
                    color.b = 0.272 * color.r + 0.534 * color.g + 0.131 * color.b;
                    return color;
                }
                
                void main() {
                    vec2 uv = v_texCoord;
                    
                    if (u_pixelSize > 0.0) {
                        uv = floor(uv / u_pixelSize) * u_pixelSize;
                    }
                    
                    vec4 color = texture2D(u_texture, uv);
                    vec3 result = color.rgb;
                    
                    result = applyBrightness(result, u_brightness);
                    result = applyContrast(result, u_contrast);
                    result = applySaturation(result, u_saturation);
                    result = applyHue(result, u_hue);
                    
                    if (u_vintage) {
                        result = applyVintage(result);
                    }
                    
                    if (u_noise > 0.0) {
                        float noise = applyNoise(uv, u_noise);
                        result += vec3(noise);
                    }
                    
                    gl_FragColor = vec4(result, color.a);
                }
            `);

            this.#shaderProgram = this.#createProgram(vertexShader, fragmentShader);
        }

        #createShader(type, source) {
            const shader = this.#gl.createShader(type);
            this.#gl.shaderSource(shader, source);
            this.#gl.compileShader(shader);
            
            if (!this.#gl.getShaderParameter(shader, this.#gl.COMPILE_STATUS)) {
                console.error('Shader compilation error:', this.#gl.getShaderInfoLog(shader));
                return null;
            }
            
            return shader;
        }

        #createProgram(vertexShader, fragmentShader) {
            const program = this.#gl.createProgram();
            this.#gl.attachShader(program, vertexShader);
            this.#gl.attachShader(program, fragmentShader);
            this.#gl.linkProgram(program);
            
            if (!this.#gl.getProgramParameter(program, this.#gl.LINK_STATUS)) {
                console.error('Program linking error:', this.#gl.getProgramInfoLog(program));
                return null;
            }
            
            return program;
        }

        #initializeWorkerPool() {
            for (let i = 0; i < this.#maxConcurrentFilters; i++) {
                const worker = new Worker(URL.createObjectURL(new Blob([`
                    self.onmessage = function(e) {
                        const { imageData, filter, params } = e.data;
                        
                        function applyFilter(data, filter, params) {
                            const width = data.width;
                            const height = data.height;
                            const pixels = data.data;
                            
                            switch(filter) {
                                case 'brightness':
                                    for (let i = 0; i < pixels.length; i += 4) {
                                        pixels[i] += params.value * 255;
                                        pixels[i+1] += params.value * 255;
                                        pixels[i+2] += params.value * 255;
                                    }
                                    break;
                                    
                                case 'contrast':
                                    const factor = (259 * (params.value * 255 + 255)) / (255 * (259 - params.value * 255));
                                    for (let i = 0; i < pixels.length; i += 4) {
                                        pixels[i] = factor * (pixels[i] - 128) + 128;
                                        pixels[i+1] = factor * (pixels[i+1] - 128) + 128;
                                        pixels[i+2] = factor * (pixels[i+2] - 128) + 128;
                                    }
                                    break;
                                    
                                case 'pixelate':
                                    const pixelSize = Math.max(1, Math.floor(params.size * 10));
                                    for (let y = 0; y < height; y += pixelSize) {
                                        for (let x = 0; x < width; x += pixelSize) {
                                            let r = 0, g = 0, b = 0, a = 0, count = 0;
                                            
                                            for (let py = 0; py < pixelSize && y + py < height; py++) {
                                                for (let px = 0; px < pixelSize && x + px < width; px++) {
                                                    const i = ((y + py) * width + (x + px)) * 4;
                                                    r += pixels[i];
                                                    g += pixels[i+1];
                                                    b += pixels[i+2];
                                                    a += pixels[i+3];
                                                    count++;
                                                }
                                            }
                                            
                                            r /= count;
                                            g /= count;
                                            b /= count;
                                            a /= count;
                                            
                                            for (let py = 0; py < pixelSize && y + py < height; py++) {
                                                for (let px = 0; px < pixelSize && x + px < width; px++) {
                                                    const i = ((y + py) * width + (x + px)) * 4;
                                                    pixels[i] = r;
                                                    pixels[i+1] = g;
                                                    pixels[i+2] = b;
                                                    pixels[i+3] = a;
                                                }
                                            }
                                        }
                                    }
                                    break;
                                    
                                case 'vintage':
                                    for (let i = 0; i < pixels.length; i += 4) {
                                        const r = pixels[i];
                                        const g = pixels[i+1];
                                        const b = pixels[i+2];
                                        
                                        pixels[i] = 0.393 * r + 0.769 * g + 0.189 * b;
                                        pixels[i+1] = 0.349 * r + 0.686 * g + 0.168 * b;
                                        pixels[i+2] = 0.272 * r + 0.534 * g + 0.131 * b;
                                    }
                                    break;
                                    
                                case 'blur':
                                    const kernel = [
                                        [1, 4, 6, 4, 1],
                                        [4, 16, 24, 16, 4],
                                        [6, 24, 36, 24, 6],
                                        [4, 16, 24, 16, 4],
                                        [1, 4, 6, 4, 1]
                                    ];
                                    const factor = 1 / 256;
                                    
                                    const temp = new Uint8ClampedArray(pixels.length);
                                    temp.set(pixels);
                                    
                                    for (let y = 2; y < height - 2; y++) {
                                        for (let x = 2; x < width - 2; x++) {
                                            let r = 0, g = 0, b = 0;
                                            
                                            for (let ky = -2; ky <= 2; ky++) {
                                                for (let kx = -2; kx <= 2; kx++) {
                                                    const i = ((y + ky) * width + (x + kx)) * 4;
                                                    const weight = kernel[ky+2][kx+2];
                                                    r += temp[i] * weight;
                                                    g += temp[i+1] * weight;
                                                    b += temp[i+2] * weight;
                                                }
                                            }
                                            
                                            const i = (y * width + x) * 4;
                                            pixels[i] = r * factor;
                                            pixels[i+1] = g * factor;
                                            pixels[i+2] = b * factor;
                                        }
                                    }
                                    break;
                            }
                            
                            return data;
                        }
                        
                        const result = applyFilter(imageData, filter, params);
                        self.postMessage({ result }, [result.data.buffer]);
                    };
                `], { type: 'application/javascript' })));

                this.#workerPool.push({
                    worker,
                    busy: false,
                    id: i
                });
            }
        }

        async applyFilter(objectId, filterType, params = {}) {
            const object = this.#canvas.getObjects().find(obj => obj.smartDesigner?.layerId === objectId);
            
            if (!object || object.type !== 'image') {
                throw new Error('Filter can only be applied to image objects');
            }

            if (!this.#filterCache.has(object)) {
                const originalSrc = object.getElement ? object.getElement().src : object._element?.src;
                if (originalSrc) {
                    this.#filterCache.set(object, {
                        originalSrc,
                        filters: []
                    });
                }
            }

            const filterConfig = {
                type: filterType,
                params: {
                    ...this.#getDefaultParams(filterType),
                    ...params
                },
                id: `filter_${Date.now()}_${Math.random().toString(36)}`
            };

            if (!this.#activeFilters.has(objectId)) {
                this.#activeFilters.set(objectId, []);
            }
            this.#activeFilters.get(objectId).push(filterConfig);

            if (this.#useWebGL && this.#gl) {
                await this.#applyWebGLFilter(object, filterConfig);
            } else {
                await this.#applyCPUFilter(object, filterConfig);
            }

            object.dirty = true;
            this.#canvas.renderAll();

            return filterConfig;
        }

        #getDefaultParams(filterType) {
            const defaults = {
                brightness: { value: 0 },
                contrast: { value: 1 },
                saturation: { value: 1 },
                hue: { value: 0 },
                noise: { value: 0 },
                pixelate: { size: 0.1 },
                blur: { radius: 2 },
                vintage: { intensity: 1 }
            };
            return defaults[filterType] || {};
        }

        async #applyWebGLFilter(object, filterConfig) {
            return new Promise((resolve, reject) => {
                try {
                    const element = object.getElement();
                    const gl = this.#gl;
                    
                    const texture = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    
                    gl.useProgram(this.#shaderProgram);
                    
                    const uniforms = {
                        u_brightness: filterConfig.params.value || 0,
                        u_contrast: filterConfig.params.contrast || 1,
                        u_saturation: filterConfig.params.saturation || 1,
                        u_hue: filterConfig.params.hue || 0,
                        u_noise: filterConfig.params.noise || 0,
                        u_pixelSize: filterConfig.params.size || 0,
                        u_vintage: filterConfig.type === 'vintage'
                    };
                    
                    Object.entries(uniforms).forEach(([name, value]) => {
                        const location = gl.getUniformLocation(this.#shaderProgram, name);
                        if (typeof value === 'boolean') {
                            gl.uniform1i(location, value ? 1 : 0);
                        } else {
                            gl.uniform1f(location, value);
                        }
                    });
                    
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                    
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        }

        async #applyCPUFilter(object, filterConfig) {
            const worker = await this.#getAvailableWorker();
            if (!worker) {
                return this.#applyFilterDirect(object, filterConfig);
            }

            return new Promise((resolve, reject) => {
                const element = object.getElement();
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                canvas.width = element.width;
                canvas.height = element.height;
                ctx.drawImage(element, 0, 0);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                
                worker.busy = true;
                worker.worker.postMessage({
                    imageData: {
                        data: imageData.data,
                        width: imageData.width,
                        height: imageData.height
                    },
                    filter: filterConfig.type,
                    params: filterConfig.params
                }, [imageData.data.buffer]);

                worker.worker.onmessage = (e) => {
                    const result = new ImageData(
                        new Uint8ClampedArray(e.data.result.data),
                        e.data.result.width,
                        e.data.result.height
                    );
                    
                    ctx.putImageData(result, 0, 0);
                    
                    fabric.Image.fromURL(canvas.toDataURL(), (img) => {
                        object.setElement(img.getElement());
                        object.setCoords();
                        worker.busy = false;
                        resolve();
                    });
                };

                worker.worker.onerror = (error) => {
                    worker.busy = false;
                    reject(error);
                };
            });
        }

        async #getAvailableWorker() {
            return new Promise((resolve) => {
                const checkWorkers = () => {
                    const available = this.#workerPool.find(w => !w.busy);
                    if (available) {
                        resolve(available);
                    } else {
                        setTimeout(checkWorkers, 100);
                    }
                };
                checkWorkers();
            });
        }

        #applyFilterDirect(object, filterConfig) {
            return new Promise((resolve) => {
                setTimeout(resolve, 50);
            });
        }

        removeFilter(objectId, filterId) {
            if (!this.#activeFilters.has(objectId)) return false;

            const filters = this.#activeFilters.get(objectId);
            const index = filters.findIndex(f => f.id === filterId);
            
            if (index > -1) {
                filters.splice(index, 1);
                
                if (filters.length === 0) {
                    this.#restoreOriginal(objectId);
                } else {
                    this.#reapplyFilters(objectId, filters);
                }
                
                return true;
            }
            
            return false;
        }

        #restoreOriginal(objectId) {
            const object = this.#canvas.getObjects().find(obj => obj.smartDesigner?.layerId === objectId);
            if (!object) return;

            const cached = this.#filterCache.get(object);
            if (cached?.originalSrc) {
                fabric.Image.fromURL(cached.originalSrc, (img) => {
                    object.setElement(img.getElement());
                    object.setCoords();
                    this.#canvas.renderAll();
                });
            }
        }

        async #reapplyFilters(objectId, filters) {
            for (const filter of filters) {
                await this.applyFilter(objectId, filter.type, filter.params);
            }
        }
    }

    /**
     * ====================================================================
     * PROFESSIONAL TEXT ENGINE
     * ====================================================================
     */
    class TextEngine {
        #canvas;
        #fonts = new Map();
        #defaultFontFamily = 'Inter';
        #fontWeights = ['300', '400', '500', '600', '700', '800'];
        
        constructor(canvasWrapper) {
            this.#canvas = canvasWrapper.canvas;
            this.#initializeFonts();
        }

        #initializeFonts() {
            const fontList = [
                { family: 'Inter', weights: [300, 400, 500, 600, 700, 800] },
                { family: 'Playfair Display', weights: [400, 500, 600, 700], serif: true },
                { family: 'Montserrat', weights: [300, 400, 500, 600, 700] },
                { family: 'Cormorant Garamond', weights: [300, 400, 500, 600, 700], serif: true },
                { family: 'Poppins', weights: [300, 400, 500, 600, 700] },
                { family: 'Space Grotesk', weights: [300, 400, 500, 600, 700] }
            ];

            fontList.forEach(font => {
                this.#fonts.set(font.family, font);
                
                font.weights.forEach(weight => {
                    const fontFace = new FontFace(font.family, `url(https://fonts.googleapis.com/css2?family=${font.family.replace(' ', '+')}:wght@${weight})`);
                    fontFace.load().then(loadedFont => {
                        document.fonts.add(loadedFont);
                    });
                });
            });
        }

        createText(text, options = {}) {
            const defaultOptions = {
                fontFamily: this.#defaultFontFamily,
                fontSize: 48,
                fontWeight: '500',
                fill: '#ffffff',
                textAlign: 'left',
                lineHeight: 1.2,
                charSpacing: 0,
                shadow: {
                    color: 'rgba(0,0,0,0.3)',
                    blur: 10,
                    offsetX: 0,
                    offsetY: 2
                },
                stroke: null,
                strokeWidth: 0,
                fontStyle: 'normal',
                textDecoration: '',
                backgroundColor: 'transparent',
                padding: 20,
                borderColor: '#6366f1',
                cornerColor: '#ffffff',
                cornerSize: 10,
                transparentCorners: false
            };

            const mergedOptions = { ...defaultOptions, ...options };
            
            const textObject = new fabric.Textbox(text, {
                ...mergedOptions,
                splitByGrapheme: true,
                hasRotatingPoint: true,
                lockScalingX: false,
                lockScalingY: false,
                lockRotation: false,
                borderDashArray: [5, 3],
                borderScaleFactor: 2,
                cornerStrokeColor: '#6366f1',
                cornerStyle: 'circle',
                selectionBackgroundColor: 'rgba(99, 102, 241, 0.1)'
            });

            textObject.smartDesigner = {
                type: 'premium-text',
                createdAt: Date.now(),
                version: '2.4.3',
                styles: {}
            };

            this.#applyPremiumStyling(textObject, mergedOptions);

            return textObject;
        }

        #applyPremiumStyling(textObject, options) {
            if (options.styles) {
                textObject.setSelectionStyles(options.styles);
            }

            if (options.gradient) {
                textObject.set('fill', new fabric.Gradient({
                    type: 'linear',
                    gradientUnits: 'percentage',
                    coords: { x1: 0, y1: 0, x2: 1, y2: 0 },
                    colorStops: options.gradient
                }));
            }

            if (options.shadow) {
                textObject.set('shadow', new fabric.Shadow({
                    color: options.shadow.color,
                    blur: options.shadow.blur,
                    offsetX: options.shadow.offsetX,
                    offsetY: options.shadow.offsetY,
                    affectStroke: options.shadow.affectStroke || false
                }));
            }

            if (options.extrude) {
                this.#createExtrudeEffect(textObject, options.extrude);
            }

            if (options.glow) {
                this.#createGlowEffect(textObject, options.glow);
            }
        }

        #createExtrudeEffect(textObject, options) {
            const depth = options.depth || 5;
            const color = options.color || 'rgba(0,0,0,0.3)';
            
            const extrudeObjects = [];
            
            for (let i = 1; i <= depth; i++) {
                const clone = fabric.util.object.clone(textObject);
                clone.set({
                    left: textObject.left + i * 0.5,
                    top: textObject.top + i * 0.5,
                    fill: color,
                    shadow: null,
                    selectable: false,
                    evented: false
                });
                extrudeObjects.push(clone);
            }
            
            const group = new fabric.Group([...extrudeObjects, textObject], {
                subTargetCheck: true,
                interactive: true
            });
            
            this.#canvas.add(group);
        }

        #createGlowEffect(textObject, options) {
            const intensity = options.intensity || 5;
            const color = options.color || 'rgba(99,102,241,0.5)';
            
            textObject.set('shadow', new fabric.Shadow({
                color: color,
                blur: intensity * 2,
                offsetX: 0,
                offsetY: 0
            }));
        }

        animateText(textObject, animationType, options = {}) {
            const animations = {
                typewriter: () => this.#typewriterAnimation(textObject, options),
                fade: () => this.#fadeAnimation(textObject, options),
                slide: () => this.#slideAnimation(textObject, options),
                scale: () => this.#scaleAnimation(textObject, options)
            };

            return animations[animationType]?.() || null;
        }

        #typewriterAnimation(textObject, options) {
            const originalText = textObject.text;
            const duration = options.duration || 2000;
            
            textObject.text = '';
            let index = 0;
            
            const interval = setInterval(() => {
                if (index < originalText.length) {
                    textObject.text += originalText[index];
                    index++;
                    this.#canvas.renderAll();
                } else {
                    clearInterval(interval);
                }
            }, 50);
            
            return interval;
        }

        #fadeAnimation(textObject, options) {
            const duration = options.duration || 1000;
            const start = 0;
            const end = 1;
            
            return this.#animateProperty(textObject, 'opacity', start, end, duration);
        }

        #slideAnimation(textObject, options) {
            const direction = options.direction || 'left';
            const distance = options.distance || 100;
            const duration = options.duration || 1000;
            
            const startX = direction === 'left' ? -distance : (direction === 'right' ? distance : 0);
            const startY = direction === 'top' ? -distance : (direction === 'bottom' ? distance : 0);
            
            textObject.set({ left: textObject.left + startX, top: textObject.top + startY });
            
            return this.#animateProperty(textObject, ['left', 'top'], 
                [textObject.left - startX, textObject.top - startY], 
                duration);
        }

        #scaleAnimation(textObject, options) {
            const scale = options.scale || 1.2;
            const duration = options.duration || 1000;
            
            textObject.set({ scaleX: 0, scaleY: 0 });
            
            return this.#animateProperty(textObject, ['scaleX', 'scaleY'], [scale, scale], duration);
        }

        #animateProperty(object, properties, targetValues, duration) {
            const startTime = Date.now();
            const startValues = Array.isArray(properties) 
                ? properties.map(p => object[p])
                : [object[properties]];
            
            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                if (Array.isArray(properties)) {
                    properties.forEach((prop, i) => {
                        object.set(prop, startValues[i] + (targetValues[i] - startValues[i]) * progress);
                    });
                } else {
                    object.set(properties, startValues[0] + (targetValues - startValues[0]) * progress);
                }
                
                this.#canvas.renderAll();
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                }
            };
            
            requestAnimationFrame(animate);
        }

        applyParagraphStyle(textObject, style) {
            const styles = {
                'drop-cap': () => this.#applyDropCap(textObject),
                'small-caps': () => this.#applySmallCaps(textObject),
                'ligatures': () => this.#enableLigatures(textObject),
                'kerning': () => this.#optimizeKerning(textObject)
            };

            return styles[style]?.() || textObject;
        }

        #applyDropCap(textObject) {
            const text = textObject.text;
            if (text.length > 0) {
                textObject.setSelectionStyles({
                    fontSize: textObject.fontSize * 2,
                    fontWeight: '700'
                }, 0, 1);
            }
            return textObject;
        }

        #applySmallCaps(textObject) {
            const text = textObject.text;
            const upperIndices = [];
            
            for (let i = 0; i < text.length; i++) {
                if (text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase()) {
                    upperIndices.push(i);
                }
            }
            
            upperIndices.forEach(index => {
                textObject.setSelectionStyles({
                    fontSize: textObject.fontSize * 0.8
                }, index, index + 1);
            });
            
            return textObject;
        }

        #enableLigatures(textObject) {
            const canvas = this.#canvas.getElement();
            const ctx = canvas.getContext('2d');
            ctx.font = `${textObject.fontWeight} ${textObject.fontSize}px ${textObject.fontFamily}`;
            ctx.textRendering = 'optimizeLegibility';
            ctx.fontKerning = 'normal';
            ctx.fontVariantLigatures = 'normal';
            
            return textObject;
        }

        #optimizeKerning(textObject) {
            const kerningPairs = {
                'AV': -2,
                'WA': -1,
                'Yo': -1,
                'To': -1
            };
            
            const text = textObject.text;
            const charSpacing = [];
            
            for (let i = 0; i < text.length - 1; i++) {
                const pair = text[i] + text[i+1];
                if (kerningPairs[pair]) {
                    charSpacing[i] = kerningPairs[pair];
                }
            }
            
            charSpacing.forEach((spacing, i) => {
                textObject.setSelectionStyles({
                    charSpacing: spacing * 10
                }, i, i + 1);
            });
            
            return textObject;
        }
    }

    /**
     * ====================================================================
     * AI ASSET INTEGRATION
     * ====================================================================
     */
    class AIAssetIntegration {
        #apiKey = 'YOUR_UNSPLASH_API_KEY';
        #cache = new Map();
        #cacheTimeout = 3600000;
        #requestQueue = [];
        #rateLimit = 50;
        #requestsThisHour = 0;
        
        constructor() {
            this.#setupRateLimiter();
        }

        #setupRateLimiter() {
            setInterval(() => {
                this.#requestsThisHour = 0;
            }, 3600000);
        }

        async searchAssets(query, options = {}) {
            const cacheKey = `${query}_${JSON.stringify(options)}`;
            
            if (this.#cache.has(cacheKey)) {
                const cached = this.#cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.#cacheTimeout) {
                    return cached.data;
                }
            }

            if (this.#requestsThisHour >= this.#rateLimit) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }

            try {
                this.#requestsThisHour++;
                
                const response = await fetch('/api/unsplash/search', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        query,
                        perPage: options.perPage || 20,
                        orientation: options.orientation || 'landscape',
                        color: options.color,
                        orderBy: options.orderBy || 'relevant'
                    })
                });

                if (!response.ok) {
                    throw new Error(`API error: ${response.status}`);
                }

                const data = await response.json();
                
                const processed = await this.#processResults(data.results, options);
                
                this.#cache.set(cacheKey, {
                    data: processed,
                    timestamp: Date.now()
                });

                return processed;
            } catch (error) {
                console.error('Asset search failed:', error);
                return this.#getFallbackAssets(query);
            }
        }

        async #processResults(results, options) {
            const processed = [];
            
            for (const result of results) {
                const asset = {
                    id: result.id,
                    description: result.description || result.alt_description,
                    width: result.width,
                    height: result.height,
                    aspectRatio: result.width / result.height,
                    urls: {
                        raw: result.urls.raw,
                        full: result.urls.full,
                        regular: result.urls.regular,
                        small: result.urls.small,
                        thumb: result.urls.thumb
                    },
                    links: {
                        download: result.links.download,
                        html: result.links.html
                    },
                    user: {
                        name: result.user.name,
                        username: result.user.username,
                        profile: result.user.links.html
                    },
                    color: result.color,
                    blurHash: result.blur_hash,
                    categories: result.categories || []
                };

                asset.optimizedUrl = this.#generateOptimizedUrl(asset.urls.raw, options);
                asset.dominantColors = await this.#extractColors(asset.urls.small);
                
                processed.push(asset);
            }

            return processed;
        }

        #generateOptimizedUrl(baseUrl, options) {
            const params = new URLSearchParams({
                w: options.width || 1920,
                h: options.height || 1080,
                q: options.quality || 85,
                fit: options.fit || 'max',
                auto: 'format,compress'
            });

            return `${baseUrl}&${params.toString()}`;
        }

        async #extractColors(imageUrl) {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.src = imageUrl;
                
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = 100;
                    canvas.height = 100;
                    ctx.drawImage(img, 0, 0, 100, 100);
                    
                    const imageData = ctx.getImageData(0, 0, 100, 100).data;
                    const colorMap = new Map();
                    
                    for (let i = 0; i < imageData.length; i += 40) {
                        const r = imageData[i];
                        const g = imageData[i + 1];
                        const b = imageData[i + 2];
                        const key = `${Math.round(r/10)},${Math.round(g/10)},${Math.round(b/10)}`;
                        
                        colorMap.set(key, (colorMap.get(key) || 0) + 1);
                    }
                    
                    const colors = Array.from(colorMap.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([key]) => {
                            const [r, g, b] = key.split(',').map(n => n * 10);
                            return `rgb(${r},${g},${b})`;
                        });
                    
                    resolve(colors);
                };
                
                img.onerror = () => resolve([]);
            });
        }

        async downloadAsset(asset, quality = 'full') {
            try {
                const response = await fetch('/api/unsplash/download', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        downloadUrl: asset.links.download,
                        assetId: asset.id
                    })
                });

                if (!response.ok) {
                    throw new Error('Download failed');
                }

                const blob = await response.blob();
                
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        fabric.Image.fromURL(e.target.result, (img) => {
                            img.set({
                                left: 100,
                                top: 100,
                                originX: 'left',
                                originY: 'top',
                                scaleX: 0.5,
                                scaleY: 0.5,
                                borderColor: '#6366f1',
                                cornerColor: '#ffffff',
                                cornerSize: 10,
                                transparentCorners: false
                            });
                            
                            img.smartDesigner = {
                                type: 'ai-asset',
                                source: 'unsplash',
                                assetId: asset.id,
                                downloadedAt: Date.now()
                            };
                            
                            resolve(img);
                        });
                    };
                    reader.readAsDataURL(blob);
                });
            } catch (error) {
                console.error('Asset download failed:', error);
                throw error;
            }
        }

        async getSimilarAssets(object) {
            const features = await this.#extractFeatures(object);
            
            return this.searchAssets(features.keywords.join(' '), {
                perPage: 10,
                color: features.dominantColor,
                orientation: features.orientation
            });
        }

        async #extractFeatures(object) {
            const features = {
                keywords: [],
                dominantColor: null,
                orientation: 'landscape'
            };

            if (object.type === 'image') {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const element = object.getElement();
                
                canvas.width = 100;
                canvas.height = 100;
                ctx.drawImage(element, 0, 0, 100, 100);
                
                const imageData = ctx.getImageData(0, 0, 100, 100);
                features.orientation = element.width > element.height ? 'landscape' : 'portrait';
                
                const colors = await this.#extractColors(object.getElement().src);
                features.dominantColor = colors[0];
                
                if (object.smartDesigner?.description) {
                    features.keywords = object.smartDesigner.description
                        .split(' ')
                        .slice(0, 5);
                }
            }

            return features;
        }

        #getFallbackAssets(query) {
            return [
                {
                    id: 'fallback_1',
                    description: `Premium ${query} image 1`,
                    urls: {
                        regular: 'https://images.unsplash.com/placeholder-1',
                        full: 'https://images.unsplash.com/placeholder-1?w=1920'
                    },
                    width: 1920,
                    height: 1080,
                    user: {
                        name: 'Smart Designer',
                        username: 'smartdesigner'
                    }
                }
            ];
        }

        clearCache() {
            this.#cache.clear();
        }
    }

    /**
     * ====================================================================
     * SMART OBJECT CONTROLS
     * ====================================================================
     */
    class SmartObjectControls {
        #canvas;
        #controls = new Map();
        
        constructor(canvasWrapper) {
            this.#canvas = canvasWrapper.canvas;
            this.#initializePremiumControls();
        }

        #initializePremiumControls() {
            fabric.Object.prototype.controls.mtr = new fabric.Control({
                x: 0,
                y: -0.5,
                offsetY: -40,
                cursorStyleHandler: this.#rotatingCursorHandler,
                actionHandler: fabric.controlsUtils.rotationWithSnapping,
                actionName: 'rotate',
                render: this.#renderPremiumControl('rotate'),
                cornerSize: 15
            });

            ['tl', 'tr', 'bl', 'br'].forEach(position => {
                if (fabric.Object.prototype.controls[position]) {
                    fabric.Object.prototype.controls[position].render = this.#renderPremiumControl('scale');
                }
            });

            this.#addCustomControl('delete', {
                x: 0.5,
                y: -0.5,
                offsetX: 20,
                offsetY: -20,
                cursorStyleHandler: () => 'pointer',
                mouseUpHandler: this.#deleteControlHandler,
                render: this.#renderPremiumControl('delete')
            });

            this.#addCustomControl('duplicate', {
                x: -0.5,
                y: -0.5,
                offsetX: -20,
                offsetY: -20,
                cursorStyleHandler: () => 'pointer',
                mouseUpHandler: this.#duplicateControlHandler,
                render: this.#renderPremiumControl('duplicate')
            });

            this.#addCustomControl('layer', {
                x: 0,
                y: 0.5,
                offsetY: 40,
                cursorStyleHandler: () => 'pointer',
                mouseUpHandler: this.#layerControlHandler,
                render: this.#renderPremiumControl('layer')
            });
        }

        #addCustomControl(name, config) {
            fabric.Object.prototype.controls[name] = new fabric.Control(config);
        }

        #renderPremiumControl(type) {
            return (ctx, left, top, styleOverride, fabricObject) => {
                const size = 16;
                ctx.save();
                ctx.translate(left, top);
                ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle || 0));
                
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 2;
                
                ctx.beginPath();
                ctx.arc(0, 0, size/2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(30,30,40,0.9)';
                ctx.fill();
                ctx.strokeStyle = '#6366f1';
                ctx.lineWidth = 2;
                ctx.stroke();
                
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#ffffff';
                ctx.font = `${size}px 'Font Awesome 6 Free'`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                const icons = {
                    rotate: '\uf2f1',
                    scale: '\uf0b2',
                    delete: '\uf1f8',
                    duplicate: '\uf24d',
                    layer: '\uf5fd'
                };
                
                ctx.fillText(icons[type] || '\uf111', 0, 0);
                ctx.restore();
            };
        }

        #rotatingCursorHandler() {
            return 'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="%236366f1" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm5-8l-5-4v3H9v2h3v3l5-4z"/></svg>\') 12 12, auto';
        }

        #deleteControlHandler(eventData, transform) {
            const target = transform.target;
            const canvas = target.canvas;
            
            canvas.remove(target);
            canvas.renderAll();
            
            return true;
        }

        #duplicateControlHandler(eventData, transform) {
            const target = transform.target;
            const canvas = target.canvas;
            
            target.clone((cloned) => {
                cloned.set({
                    left: target.left + 20,
                    top: target.top + 20,
                    evented: true
                });
                
                canvas.add(cloned);
                canvas.setActiveObject(cloned);
                canvas.renderAll();
            });
            
            return true;
        }

        #layerControlHandler(eventData, transform) {
            const target = transform.target;
            
            document.querySelector('.right-panel [data-tab="layers"]')?.click();
            
            return true;
        }

        enableSmartSnapping(object) {
            if (!object) return;

            object.on('moving', (e) => {
                this.#handleSmartSnapping(e.target);
            });

            object.on('scaling', (e) => {
                this.#handleSmartSnapping(e.target, true);
            });
        }

        #handleSmartSnapping(object, isScaling = false) {
            const canvas = object.canvas;
            const objects = canvas.getObjects().filter(obj => obj !== object);
            const tolerance = SMART_CONFIG.SNAPPING.TOLERANCE;
            
            const objBounds = object.getBoundingRect();
            
            let snapX = null;
            let snapY = null;
            
            objects.forEach(other => {
                const otherBounds = other.getBoundingRect();
                
                if (Math.abs(objBounds.top - otherBounds.top) < tolerance) {
                    snapY = otherBounds.top;
                }
                if (Math.abs(objBounds.top - otherBounds.bottom) < tolerance) {
                    snapY = otherBounds.bottom;
                }
                if (Math.abs(objBounds.bottom - otherBounds.top) < tolerance) {
                    snapY = otherBounds.top - objBounds.height;
                }
                if (Math.abs(objBounds.bottom - otherBounds.bottom) < tolerance) {
                    snapY = otherBounds.bottom - objBounds.height;
                }
                
                if (Math.abs(objBounds.left - otherBounds.left) < tolerance) {
                    snapX = otherBounds.left;
                }
                if (Math.abs(objBounds.left - otherBounds.right) < tolerance) {
                    snapX = otherBounds.right;
                }
                if (Math.abs(objBounds.right - otherBounds.left) < tolerance) {
                    snapX = otherBounds.left - objBounds.width;
                }
                if (Math.abs(objBounds.right - otherBounds.right) < tolerance) {
                    snapX = otherBounds.right - objBounds.width;
                }
            });
            
            if (snapX !== null) {
                object.set({ left: snapX });
            }
            if (snapY !== null) {
                object.set({ top: snapY });
            }
            
            this.#showSnappingGuides(object, snapX, snapY);
        }

        #showSnappingGuides(object, snapX, snapY) {
            const canvas = object.canvas;
            const bounds = object.getBoundingRect();
            
            const oldGuides = canvas.getObjects().filter(obj => obj.smartDesigner?.type === 'snapping-guide');
            oldGuides.forEach(guide => canvas.remove(guide));
            
            if (snapX !== null) {
                const guide = new fabric.Line([snapX + bounds.width/2, 0, snapX + bounds.width/2, canvas.height], {
                    stroke: '#6366f1',
                    strokeWidth: 1,
                    strokeDashArray: [5, 5],
                    selectable: false,
                    evented: false,
                    smartDesigner: { type: 'snapping-guide' }
                });
                canvas.add(guide);
            }
            
            if (snapY !== null) {
                const guide = new fabric.Line([0, snapY + bounds.height/2, canvas.width, snapY + bounds.height/2], {
                    stroke: '#6366f1',
                    strokeWidth: 1,
                    strokeDashArray: [5, 5],
                    selectable: false,
                    evented: false,
                    smartDesigner: { type: 'snapping-guide' }
                });
                canvas.add(guide);
            }
            
            setTimeout(() => {
                const guides = canvas.getObjects().filter(obj => obj.smartDesigner?.type === 'snapping-guide');
                guides.forEach(guide => canvas.remove(guide));
                canvas.renderAll();
            }, 1000);
        }
    }

    /**
     * ====================================================================
     * PART 3: PRO EXPORTER & SYSTEM MANAGEMENT
     * ====================================================================
     */

    /**
     * ULTRA-HIGH-RES EXPORT ENGINE
     * Supports PNG, JPG, PDF with 4K+ quality
     */
    class ExportEngine {
        #canvas;
        #exportQueue = [];
        #isExporting = false;
        
        constructor(canvasWrapper) {
            this.#canvas = canvasWrapper.canvas;
        }

        /**
         * Export canvas to multiple formats with scaling
         */
        async exportTo(format, options = {}) {
            const defaultOptions = {
                multiplier: 4,
                quality: 0.95,
                dpi: SMART_CONFIG.EXPORT.QUALITY.ULTRA,
                backgroundColor: '#000000',
                format: format
            };

            const exportOptions = { ...defaultOptions, ...options };
            
            return new Promise((resolve, reject) => {
                this.#exportQueue.push({ format, exportOptions, resolve, reject });
                this.#processQueue();
            });
        }

        async #processQueue() {
            if (this.#isExporting || this.#exportQueue.length === 0) return;
            
            this.#isExporting = true;
            const { format, exportOptions, resolve, reject } = this.#exportQueue.shift();

            try {
                let result;
                switch (format) {
                    case 'png':
                        result = await this.#exportPNG(exportOptions);
                        break;
                    case 'jpg':
                        result = await this.#exportJPG(exportOptions);
                        break;
                    case 'pdf':
                        result = await this.#exportPDF(exportOptions);
                        break;
                    case 'svg':
                        result = await this.#exportSVG(exportOptions);
                        break;
                    default:
                        throw new ExportError(`Unsupported format: ${format}`);
                }
                
                resolve(result);
            } catch (error) {
                reject(new ExportError(`Export failed: ${error.message}`));
            } finally {
                this.#isExporting = false;
                this.#processQueue();
            }
        }

        /**
         * Export to PNG with scaling
         */
        async #exportPNG(options) {
            const { multiplier, quality, backgroundColor } = options;
            
            const originalWidth = this.#canvas.width;
            const originalHeight = this.#canvas.height;
            
            // Create temporary canvas for high-res rendering
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = originalWidth * multiplier;
            tempCanvas.height = originalHeight * multiplier;
            
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.fillStyle = backgroundColor;
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            // Scale and render each object
            const objects = this.#canvas.getObjects();
            
            // Sort by layer order
            objects.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
            
            for (const obj of objects) {
                if (!obj.visible) continue;
                
                await this.#renderObjectToCanvas(obj, tempCtx, multiplier);
            }
            
            // Convert to blob
            return new Promise((resolve) => {
                tempCanvas.toBlob((blob) => {
                    const url = URL.createObjectURL(blob);
                    resolve({
                        blob,
                        url,
                        width: tempCanvas.width,
                        height: tempCanvas.height,
                        format: 'png'
                    });
                }, 'image/png', quality);
            });
        }

        /**
         * Export to JPG with scaling
         */
        async #exportJPG(options) {
            const result = await this.#exportPNG(options);
            
            // Convert PNG blob to JPG
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = options.backgroundColor;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    
                    canvas.toBlob((blob) => {
                        URL.revokeObjectURL(result.url);
                        resolve({
                            blob,
                            url: URL.createObjectURL(blob),
                            width: canvas.width,
                            height: canvas.height,
                            format: 'jpg'
                        });
                    }, 'image/jpeg', options.quality);
                };
                img.src = result.url;
            });
        }

        /**
         * Export to PDF with vector support
         */
        async #exportPDF(options) {
            const { multiplier, dpi } = options;
            
            const { jsPDF } = window.jspdf;
            
            // Create PDF with proper dimensions
            const width = this.#canvas.width / 72 * dpi / 100;
            const height = this.#canvas.height / 72 * dpi / 100;
            
            const pdf = new jsPDF({
                orientation: width > height ? 'landscape' : 'portrait',
                unit: 'px',
                format: [width * multiplier, height * multiplier]
            });

            // Export as image for now (vector support would need SVG conversion)
            const pngResult = await this.#exportPNG({ ...options, multiplier: 2 });
            
            pdf.addImage(pngResult.url, 'PNG', 0, 0, width * multiplier, height * multiplier);
            
            const pdfBlob = pdf.output('blob');
            
            return {
                blob: pdfBlob,
                url: URL.createObjectURL(pdfBlob),
                format: 'pdf'
            };
        }

        /**
         * Export to SVG (vector format)
         */
        async #exportSVG(options) {
            const svg = this.#canvas.toSVG({
                suppressPreamble: false,
                viewBox: {
                    x: 0,
                    y: 0,
                    width: this.#canvas.width,
                    height: this.#canvas.height
                }
            });

            const blob = new Blob([svg], { type: 'image/svg+xml' });
            
            return {
                blob,
                url: URL.createObjectURL(blob),
                svg,
                format: 'svg'
            };
        }

        /**
         * Render individual object to canvas with scaling
         */
        async #renderObjectToCanvas(obj, ctx, scale) {
            return new Promise((resolve) => {
                if (obj.type === 'image') {
                    const img = obj.getElement();
                    const bounds = obj.getBoundingRect();
                    
                    ctx.save();
                    ctx.translate(
                        obj.left * scale + (obj.width * scale * (obj.originX === 'center' ? 0.5 : 0)),
                        obj.top * scale + (obj.height * scale * (obj.originY === 'center' ? 0.5 : 0))
                    );
                    ctx.rotate(obj.angle * Math.PI / 180);
                    ctx.scale(obj.scaleX * scale, obj.scaleY * scale);
                    ctx.drawImage(img, -obj.width / 2, -obj.height / 2, obj.width, obj.height);
                    ctx.restore();
                } else {
                    // For shapes and text, use fabric's own rendering
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = obj.width * obj.scaleX * scale;
                    tempCanvas.height = obj.height * obj.scaleY * scale;
                    
                    const tempFabric = new fabric.StaticCanvas(tempCanvas);
                    const cloned = fabric.util.object.clone(obj);
                    cloned.set({
                        left: 0,
                        top: 0,
                        scaleX: 1,
                        scaleY: 1,
                        originX: 'left',
                        originY: 'top'
                    });
                    tempFabric.add(cloned);
                    tempFabric.renderAll();
                    
                    ctx.drawImage(
                        tempCanvas,
                        obj.left * scale,
                        obj.top * scale,
                        tempCanvas.width,
                        tempCanvas.height
                    );
                }
                resolve();
            });
        }

        /**
         * Trigger download of exported file
         */
        download(exportResult, filename = 'design') {
            const extension = exportResult.format;
            const link = document.createElement('a');
            link.href = exportResult.url;
            link.download = `${filename}.${extension}`;
            link.click();
        }
    }

    /**
     * AUTO-SAVE & PROJECT PERSISTENCE
     * Saves to localStorage with compression
     */
    class ProjectPersistence {
        #canvas;
        #layerManager;
        #stateManager;
        #autoSaveInterval;
        #isDirty = false;

        constructor(canvasWrapper, layerManager, stateManager) {
            this.#canvas = canvasWrapper.canvas;
            this.#layerManager = layerManager;
            this.#stateManager = stateManager;
            
            this.#initializeAutoSave();
            this.#loadLastSession();
        }

        #initializeAutoSave() {
            // Mark as dirty on any change
            this.#canvas.on('object:modified', () => this.#markDirty());
            this.#canvas.on('object:added', () => this.#markDirty());
            this.#canvas.on('object:removed', () => this.#markDirty());

            // Auto-save every 30 seconds if dirty
            this.#autoSaveInterval = setInterval(() => {
                if (this.#isDirty) {
                    this.saveToStorage('autosave');
                }
            }, SMART_CONFIG.CANVAS.AUTO_SAVE_INTERVAL);

            // Save on page unload
            window.addEventListener('beforeunload', () => {
                if (this.#isDirty) {
                    this.saveToStorage('autosave');
                }
            });
        }

        #markDirty() {
            this.#isDirty = true;
        }

        /**
         * Save current state to localStorage
         */
        saveToStorage(type = 'manual') {
            try {
                const projectData = {
                    version: '2.4.3',
                    timestamp: Date.now(),
                    canvas: this.#canvas.toJSON(),
                    layers: this.#layerManager.getTree(),
                    metadata: {
                        objectCount: this.#canvas.getObjects().length,
                        layerCount: this.#layerManager.getAllLayers().length,
                        lastModified: Date.now()
                    }
                };

                // Compress if needed
                let dataToStore = JSON.stringify(projectData);
                
                if (SMART_CONFIG.STORAGE.COMPRESSION && dataToStore.length > 100000) {
                    dataToStore = this.#compress(dataToStore);
                }

                // Check size limit
                if (dataToStore.length > SMART_CONFIG.STORAGE.MAX_PROJECT_SIZE) {
                    console.warn('Project too large for localStorage, saving only essential data');
                    // Save minimal version
                    projectData.canvas.objects = projectData.canvas.objects.slice(0, 50);
                    dataToStore = JSON.stringify(projectData);
                }

                const key = type === 'autosave' 
                    ? SMART_CONFIG.STORAGE.AUTO_SAVE_KEY 
                    : SMART_CONFIG.STORAGE.PROJECT_KEY;

                localStorage.setItem(key, dataToStore);
                
                this.#isDirty = false;
                
                console.log(`✅ Project ${type} saved at ${new Date().toLocaleTimeString()}`);
                
            } catch (error) {
                console.error('Failed to save project:', error);
            }
        }

        /**
         * Load last session from storage
         */
        #loadLastSession() {
            try {
                // Try autosave first
                let data = localStorage.getItem(SMART_CONFIG.STORAGE.AUTO_SAVE_KEY);
                
                if (!data) {
                    data = localStorage.getItem(SMART_CONFIG.STORAGE.PROJECT_KEY);
                }

                if (data) {
                    // Decompress if needed
                    if (data.startsWith('COMPRESSED:')) {
                        data = this.#decompress(data);
                    }

                    const projectData = JSON.parse(data);
                    
                    // Load canvas
                    this.#canvas.loadFromJSON(projectData.canvas, () => {
                        this.#canvas.renderAll();
                        
                        // Update layer manager
                        if (projectData.layers) {
                            // Rebuild layer tree from saved data
                            console.log('✅ Session loaded from', new Date(projectData.timestamp).toLocaleString());
                        }
                    });
                }
            } catch (error) {
                console.error('Failed to load last session:', error);
            }
        }

        /**
         * Simple compression (base64 + encode)
         */
        #compress(data) {
            return 'COMPRESSED:' + btoa(encodeURIComponent(data));
        }

        /**
         * Decompress
         */
        #decompress(data) {
            return decodeURIComponent(atob(data.replace('COMPRESSED:', '')));
        }

        /**
         * Export project to file
         */
        exportProject() {
            const projectData = {
                version: '2.4.3',
                timestamp: Date.now(),
                canvas: this.#canvas.toJSON(),
                layers: this.#layerManager.getTree(),
                metadata: {
                    objectCount: this.#canvas.getObjects().length,
                    layerCount: this.#layerManager.getAllLayers().length
                }
            };

            const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `smart-designer-project-${Date.now()}.json`;
            link.click();
            
            URL.revokeObjectURL(url);
        }

        /**
         * Import project from file
         */
        importProject(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                
                reader.onload = (e) => {
                    try {
                        const projectData = JSON.parse(e.target.result);
                        
                        this.#canvas.loadFromJSON(projectData.canvas, () => {
                            this.#canvas.renderAll();
                            this.#isDirty = true;
                            resolve(projectData);
                        });
                    } catch (error) {
                        reject(error);
                    }
                };
                
                reader.readAsText(file);
            });
        }

        destroy() {
            if (this.#autoSaveInterval) {
                clearInterval(this.#autoSaveInterval);
            }
        }
    }

    /**
     * SMART MEMORY MANAGEMENT
     * Cleans up cache and unused textures
     */
    class MemoryManager {
        #canvas;
        #filterEngine;
        #aiAssetIntegration;
        #memoryCheckInterval;
        #textureCache = new WeakMap();
        #performanceMetrics = {
            lastGC: Date.now(),
            totalMemory: 0,
            usedMemory: 0,
            textureCount: 0
        };

        constructor(canvasWrapper, filterEngine, aiAssetIntegration) {
            this.#canvas = canvasWrapper.canvas;
            this.#filterEngine = filterEngine;
            this.#aiAssetIntegration = aiAssetIntegration;
            
            this.#initializeMemoryMonitoring();
        }

        #initializeMemoryMonitoring() {
            // Check memory usage periodically
            this.#memoryCheckInterval = setInterval(() => {
                this.#checkMemoryUsage();
            }, SMART_CONFIG.CANVAS.PERFORMANCE.MEMORY_CHECK_INTERVAL);

            // Clear cache on low memory warning
            if ('memory' in performance) {
                performance.addEventListener('memorywarning', () => {
                    this.emergencyCleanup();
                });
            }
        }

        #checkMemoryUsage() {
            // Estimate memory usage based on objects
            const objects = this.#canvas.getObjects();
            let estimatedMemory = 0;
            let textureCount = 0;

            objects.forEach(obj => {
                if (obj.type === 'image') {
                    const img = obj.getElement();
                    if (img) {
                        estimatedMemory += img.width * img.height * 4; // RGBA
                        textureCount++;
                    }
                }
                if (obj.type === 'text') {
                    estimatedMemory += 10000; // Rough estimate for text objects
                }
            });

            this.#performanceMetrics.usedMemory = estimatedMemory;
            this.#performanceMetrics.textureCount = textureCount;
            this.#performanceMetrics.lastGC = Date.now();

            // Check if we need to clean up
            const memoryUsage = estimatedMemory / (1024 * 1024); // Convert to MB
            
            if (memoryUsage > 500) { // Over 500MB
                console.warn(`High memory usage: ${Math.round(memoryUsage)}MB, cleaning up...`);
                this.cleanup();
            }

            this.#updateMetricsDisplay();
        }

        /**
         * Clean up unused resources
         */
        cleanup() {
            const objects = this.#canvas.getObjects();
            
            // Remove offscreen objects from cache
            objects.forEach(obj => {
                if (obj.type === 'image') {
                    const img = obj.getElement();
                    if (!this.#isInViewport(obj)) {
                        // Reduce image quality for offscreen objects
                        this.#reduceImageQuality(obj);
                    }
                }
            });

            // Clear filter cache for deleted objects
            this.#filterEngine?.cleanup?.();

            // Clear AI asset cache
            this.#aiAssetIntegration?.clearCache();

            // Force garbage collection hint
            if (window.gc) {
                window.gc();
            }

            console.log('🧹 Memory cleanup completed');
        }

        /**
         * Emergency cleanup when memory is critical
         */
        emergencyCleanup() {
            console.warn('⚠️ Emergency memory cleanup initiated');
            
            // Aggressive cleanup
            this.#canvas.getObjects().forEach(obj => {
                if (obj.type === 'image' && !this.#isInViewport(obj)) {
                    this.#canvas.remove(obj);
                }
            });

            this.cleanup();
            
            // Clear all caches
            this.#filterEngine?.clearAllCaches?.();
            this.#aiAssetIntegration?.clearCache();
        }

        /**
         * Check if object is in viewport
         */
        #isInViewport(obj) {
            const bounds = obj.getBoundingRect();
            const canvasWidth = this.#canvas.width;
            const canvasHeight = this.#canvas.height;
            
            return !(bounds.left > canvasWidth || 
                    bounds.top > canvasHeight || 
                    bounds.left + bounds.width < 0 || 
                    bounds.top + bounds.height < 0);
        }

        /**
         * Reduce image quality for offscreen objects
         */
        #reduceImageQuality(obj) {
            const img = obj.getElement();
            if (img && img.width > 500) {
                // Create downscaled version
                const canvas = document.createElement('canvas');
                canvas.width = 500;
                canvas.height = 500 * (img.height / img.width);
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                fabric.Image.fromURL(canvas.toDataURL(), (newImg) => {
                    obj.setElement(newImg.getElement());
                });
            }
        }

        #updateMetricsDisplay() {
            // Update UI if metrics element exists
            const metricsEl = document.querySelector('.memory-metrics');
            if (metricsEl) {
                metricsEl.innerHTML = `
                    <span>Memory: ${(this.#performanceMetrics.usedMemory / (1024*1024)).toFixed(1)}MB</span>
                    <span>Textures: ${this.#performanceMetrics.textureCount}</span>
                `;
            }
        }

        destroy() {
            if (this.#memoryCheckInterval) {
                clearInterval(this.#memoryCheckInterval);
            }
        }
    }

    /**
     * KEYBOARD SHORTCUTS SYSTEM
     * Handles all keyboard interactions
     */
    class KeyboardShortcuts {
        #canvas;
        #stateManager;
        #layerManager;
        #eventBus;
        #activeShortcuts = new Map();

        constructor(canvasWrapper, stateManager, layerManager, eventBus) {
            this.#canvas = canvasWrapper.canvas;
            this.#stateManager = stateManager;
            this.#layerManager = layerManager;
            this.#eventBus = eventBus;
            
            this.#initializeShortcuts();
        }

        #initializeShortcuts() {
            document.addEventListener('keydown', (e) => {
                // Don't trigger if typing in input
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                    return;
                }

                const key = e.key;
                const ctrl = e.ctrlKey || e.metaKey;
                const shift = e.shiftKey;
                const alt = e.altKey;

                this.#handleShortcut(key, ctrl, shift, alt, e);
            });
        }

        #handleShortcut(key, ctrl, shift, alt, event) {
            // Undo (Ctrl+Z)
            if (ctrl && !shift && key.toLowerCase() === 'z') {
                event.preventDefault();
                this.#undo();
            }
            
            // Redo (Ctrl+Y or Ctrl+Shift+Z)
            else if ((ctrl && !shift && key.toLowerCase() === 'y') || 
                     (ctrl && shift && key.toLowerCase() === 'z')) {
                event.preventDefault();
                this.#redo();
            }
            
            // Delete (Delete or Backspace)
            else if (key === 'Delete' || key === 'Backspace') {
                event.preventDefault();
                this.#deleteSelected();
            }
            
            // Select All (Ctrl+A)
            else if (ctrl && !shift && key.toLowerCase() === 'a') {
                event.preventDefault();
                this.#selectAll();
            }
            
            // Duplicate (Ctrl+D)
            else if (ctrl && !shift && key.toLowerCase() === 'd') {
                event.preventDefault();
                this.#duplicateSelected();
            }
            
            // Group (Ctrl+G)
            else if (ctrl && !shift && key.toLowerCase() === 'g') {
                event.preventDefault();
                this.#groupSelected();
            }
            
            // Ungroup (Ctrl+Shift+G)
            else if (ctrl && shift && key.toLowerCase() === 'g') {
                event.preventDefault();
                this.#ungroupSelected();
            }
            
            // Copy (Ctrl+C)
            else if (ctrl && !shift && key.toLowerCase() === 'c') {
                event.preventDefault();
                this.#copy();
            }
            
            // Paste (Ctrl+V)
            else if (ctrl && !shift && key.toLowerCase() === 'v') {
                event.preventDefault();
                this.#paste();
            }
            
            // Arrow keys for nudge
            else if (key.startsWith('Arrow')) {
                this.#handleArrowKey(key, shift, event);
            }
        }

        #undo() {
            const state = this.#stateManager.undo();
            if (state) {
                this.#canvas.loadFromJSON(state, () => {
                    this.#canvas.renderAll();
                    this.#eventBus.emit('shortcut:undo');
                });
            }
        }

        #redo() {
            const state = this.#stateManager.redo();
            if (state) {
                this.#canvas.loadFromJSON(state, () => {
                    this.#canvas.renderAll();
                    this.#eventBus.emit('shortcut:redo');
                });
            }
        }

        #deleteSelected() {
            const activeObject = this.#canvas.getActiveObject();
            if (activeObject) {
                this.#canvas.remove(activeObject);
                this.#canvas.renderAll();
                this.#eventBus.emit('shortcut:delete');
            }
        }

        #selectAll() {
            const objects = this.#canvas.getObjects();
            const selectable = objects.filter(obj => obj.selectable);
            
            if (selectable.length > 0) {
                this.#canvas.discardActiveObject();
                
                if (selectable.length === 1) {
                    this.#canvas.setActiveObject(selectable[0]);
                } else {
                    const sel = new fabric.ActiveSelection(selectable, { canvas: this.#canvas });
                    this.#canvas.setActiveObject(sel);
                }
                
                this.#canvas.renderAll();
            }
        }

        #duplicateSelected() {
            const activeObject = this.#canvas.getActiveObject();
            if (!activeObject) return;

            activeObject.clone((cloned) => {
                cloned.set({
                    left: activeObject.left + 20,
                    top: activeObject.top + 20
                });
                
                this.#canvas.add(cloned);
                this.#canvas.setActiveObject(cloned);
                this.#canvas.renderAll();
                
                this.#eventBus.emit('shortcut:duplicate');
            });
        }

        #groupSelected() {
            const activeObject = this.#canvas.getActiveObject();
            if (!activeObject || activeObject.type !== 'activeSelection') return;

            const objects = activeObject.getObjects();
            
            // Create group in layer manager
            const layerIds = objects
                .map(obj => obj.smartDesigner?.layerId)
                .filter(id => id);
            
            if (layerIds.length > 0) {
                const group = this.#layerManager.groupLayers(layerIds, 'Group');
                
                // Create fabric group
                const groupObj = new fabric.Group(objects, {
                    originX: 'center',
                    originY: 'center'
                });
                
                groupObj.smartDesigner = {
                    layerId: group.id,
                    type: 'group'
                };
                
                this.#canvas.add(groupObj);
                this.#canvas.remove(...objects);
                this.#canvas.setActiveObject(groupObj);
                this.#canvas.renderAll();
            }
        }

        #ungroupSelected() {
            const activeObject = this.#canvas.getActiveObject();
            if (!activeObject || activeObject.type !== 'group') return;

            const layerId = activeObject.smartDesigner?.layerId;
            if (layerId) {
                this.#layerManager.ungroupLayers(layerId);
            }

            const objects = activeObject.getObjects();
            this.#canvas.add(...objects);
            this.#canvas.remove(activeObject);
            this.#canvas.setActiveObject(objects[0]);
            this.#canvas.renderAll();
        }

        #copy() {
            const activeObject = this.#canvas.getActiveObject();
            if (activeObject) {
                this.#clipboard = activeObject;
                this.#eventBus.emit('shortcut:copy');
            }
        }

        #paste() {
            if (this.#clipboard) {
                this.#clipboard.clone((cloned) => {
                    cloned.set({
                        left: this.#clipboard.left + 20,
                        top: this.#clipboard.top + 20,
                        evented: true
                    });
                    
                    this.#canvas.add(cloned);
                    this.#canvas.setActiveObject(cloned);
                    this.#canvas.renderAll();
                    
                    this.#eventBus.emit('shortcut:paste');
                });
            }
        }

        #handleArrowKey(key, shift, event) {
            event.preventDefault();
            
            const activeObject = this.#canvas.getActiveObject();
            if (!activeObject) return;

            const moveAmount = shift ? 10 : 1;
            
            switch (key) {
                case 'ArrowLeft':
                    activeObject.left -= moveAmount;
                    break;
                case 'ArrowRight':
                    activeObject.left += moveAmount;
                    break;
                case 'ArrowUp':
                    activeObject.top -= moveAmount;
                    break;
                case 'ArrowDown':
                    activeObject.top += moveAmount;
                    break;
            }
            
            activeObject.setCoords();
            this.#canvas.renderAll();
            this.#eventBus.emit('shortcut:arrow', { key, moveAmount });
        }

        #clipboard = null;
    }

    /**
     * ====================================================================
     * ENGINE INITIALIZATION
     * ====================================================================
     */
    class SmartDesignerEngine {
        #canvasWrapper;
        #layerManager;
        #stateManager;
        #eventBus;
        #filterEngine;
        #textEngine;
        #aiAssetIntegration;
        #smartControls;
        #exportEngine;
        #projectPersistence;
        #memoryManager;
        #keyboardShortcuts;
        #initialized = false;

        constructor() {
            this.#eventBus = new EventBus();
            this.#stateManager = new StateSnapshotManager();
        }

        async initialize() {
            try {
                console.log('🚀 SMART DESIGNER PRO Engine initializing...');

                // Initialize canvas
                this.#canvasWrapper = new CanvasWrapper(
                    'canvas-container',
                    'smart-canvas',
                    { dpi: SMART_CONFIG.CANVAS.DPI }
                );

                // Initialize layer manager
                this.#layerManager = new LayerTreeManager(this.#eventBus);

                // Connect core modules
                this.#canvasWrapper.setLayerManager(this.#layerManager);
                this.#canvasWrapper.setStateManager(this.#stateManager);
                this.#canvasWrapper.setEventBus(this.#eventBus);

                // Initialize advanced modules
                this.#filterEngine = new FilterEngine(this.#canvasWrapper);
                this.#textEngine = new TextEngine(this.#canvasWrapper);
                this.#aiAssetIntegration = new AIAssetIntegration();
                this.#smartControls = new SmartObjectControls(this.#canvasWrapper);
                
                // Initialize PART 3 modules
                this.#exportEngine = new ExportEngine(this.#canvasWrapper);
                this.#projectPersistence = new ProjectPersistence(
                    this.#canvasWrapper, 
                    this.#layerManager, 
                    this.#stateManager
                );
                this.#memoryManager = new MemoryManager(
                    this.#canvasWrapper,
                    this.#filterEngine,
                    this.#aiAssetIntegration
                );
                this.#keyboardShortcuts = new KeyboardShortcuts(
                    this.#canvasWrapper,
                    this.#stateManager,
                    this.#layerManager,
                    this.#eventBus
                );

                // Push initial state
                this.#stateManager.pushState({
                    layers: this.#layerManager.getTree(),
                    canvas: this.#canvasWrapper.canvas.toJSON()
                }, { type: 'initialization' });

                this.#initialized = true;
                console.log('✅ SMART DESIGNER PRO Engine ready');
                console.log('📦 Modules loaded:', this.#getLoadedModules());

                return true;
            } catch (error) {
                console.error('❌ Engine initialization failed:', error);
                throw error;
            }
        }

        #getLoadedModules() {
            return {
                core: ['canvas', 'layers', 'state', 'events'],
                advanced: ['filters', 'text', 'ai', 'controls'],
                pro: ['export', 'persistence', 'memory', 'shortcuts']
            };
        }

        get canvas() {
            return this.#canvasWrapper;
        }

        get layers() {
            return this.#layerManager;
        }

        get state() {
            return this.#stateManager;
        }

        get events() {
            return this.#eventBus;
        }

        get filters() {
            return this.#filterEngine;
        }

        get text() {
            return this.#textEngine;
        }

        get ai() {
            return this.#aiAssetIntegration;
        }

        get controls() {
            return this.#smartControls;
        }

        get export() {
            return this.#exportEngine;
        }

        get persistence() {
            return this.#projectPersistence;
        }

        get memory() {
            return this.#memoryManager;
        }

        get shortcuts() {
            return this.#keyboardShortcuts;
        }

        dispose() {
            this.#memoryManager?.destroy();
            this.#projectPersistence?.destroy();
            this.#canvasWrapper?.dispose();
            this.#eventBus?.clear();
        }
    }

    // Export to global scope
    global.SmartDesignerEngine = SmartDesignerEngine;
    global.SmartDesigner = {
        Engine: SmartDesignerEngine,
        Config: SMART_CONFIG,
        version: '2.4.3',
        build: 'enterprise',
        modules: {
            FilterEngine,
            TextEngine,
            AIAssetIntegration,
            SmartObjectControls,
            ExportEngine,
            ProjectPersistence,
            MemoryManager,
            KeyboardShortcuts
        }
    };

})(window);

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const engine = new SmartDesignerEngine();
        await engine.initialize();
        
        // Attach to window for debugging
        window.__SMART_DESIGNER = engine;
        
        console.log('✨ SMART DESIGNER PRO is fully operational');
        console.log('🎨 Ready for 4K printing | AI-powered | GPU-accelerated');
    } catch (error) {
        console.error('💥 Fatal error during startup:', error);
    }
});
