'use strict'
/*
 * 检查浏览器是否支持sticky属性或者版本太旧无法运行polyfill，
 * 如果这两种情况都存在，则设置styFlag标志。
 */

let styFlag = false;

// 判断window是否存在
const isWindowDefined = typeof window == 'undefined';

// 对没有window对象或者window.getComputeStyle的polyfill
if (!isWindowDefined || !window.getComputedStyle) {
	styFlag = true;
} else {
	const testNode = document.createElement('div');
	// 如果浏览器本身支持“ position：sticky”，则不会造成任何影响
	if (
		['', '-webkit-', '-moz-', '-ms-'].some(prefix => {
			try {
				testNode.style.position = prefix + 'sticky';
			} catch (e) {
				console.log(e)
			}
			return testNode.style.position != '';
		})
	) {
		styFlag = true;
	}
}

/*
 * 全局变量
 */

let isInitialized = false;

// 创建一个sticky实例数组
const stickies = [];

// 检查Shadow Root构造函数是否存在，以使进一步的检查更简单
const shadowRootExists = typeof ShadowRoot !== 'undefined'

// 上次保存的滚动位置
const scroll = {
	top: null,
	left: null
};


/*
 * 全局方法
 */

function extend (targetObj, sourceObject) {
	for (var key in sourceObject) {
		if (sourceObject.hasOwnProperty(key)) {
			targetObj[key] = sourceObject[key];
		}
	}
}

function parseNumeric (val) {
	return parseFloat(val) || 0;
}

function getDocOffsetTop (node) {
	let docOffsetTop = 0;

	while (node) {
		docOffsetTop += node.offsetTop;
		node = node.offsetParent;
	}

	return docOffsetTop;
}

/*
 * Sticky class
 */
class Sticky {
	constructor (node) {
		if (!(node instanceof HTMLElement)) {
			throw new Error('第一个参数必须为HTML的节点');
		}
		if (stickies.some(sticky => sticky._node === node)) {
			throw new Error('sticky-js已应用于此节点');
		}

		this._node = node;
		this._stickyMode = null;
		this._active = false;
		this._removed = false;

		stickies.push(this);

		this.refresh();
	}

	refresh () {
		if (styFlag || this._removed) {
			return;
		}
		if (this._active) {
			this._deactivate();
		}

		const node = this._node;

		/*
		 * 保存节点计算的props
		 */
		const nodeComputedStyle = getComputedStyle(node)
		const nodeComputedProps = {
			position: nodeComputedStyle.position,
			top: nodeComputedStyle.top,
			display: nodeComputedStyle.display,
			marginTop: nodeComputedStyle.marginTop,
			marginBottom: nodeComputedStyle.marginBottom,
			marginLeft: nodeComputedStyle.marginLeft,
			marginRight: nodeComputedStyle.marginRight,
			cssFloat: nodeComputedStyle.cssFloat
		}

		/*
		 * 检查节点是否可用
		 */
		if (
			isNaN(parseFloat(nodeComputedProps.top)) ||
			nodeComputedProps.display == 'table-cell' ||
			nodeComputedProps.display == 'none'
		) return;

		this._active = true

		/*
		 * 检查当前节点位置是否为“粘性”。如果是，则表示浏览器支持粘性定位，但polyfill已强制启用。
		 * 在继续操作之前，我们将节点的位置设置为“静态”，以便在收集其参数时该节点处于其初始位置。
		 */
		const originalPosition = node.style.position;
		if (nodeComputedStyle.position == 'sticky' || nodeComputedStyle.position == '-webkit-sticky') {
			node.style.position = 'static'
		}

		/*
		 * 获取必要的节点参数
		 */
		const referenceNode = node.parentNode;
		const parentNode = shadowRootExists && referenceNode instanceof ShadowRoot ? referenceNode.host : referenceNode;
		const nodeWinOffset = node.getBoundingClientRect();
		const parentWinOffset = parentNode.getBoundingClientRect();
		const parentComputedStyle = getComputedStyle(parentNode);

		this._parent = {
			node: parentNode,
			styles: {
				position: parentNode.style.position
			},
			offsetHeight: parentNode.offsetHeight
		};
		this._offsetToWindow = {
			left: nodeWinOffset.left,
			right: document.documentElement.clientWidth - nodeWinOffset.right
		};
		this._offsetToParent = {
			top: nodeWinOffset.top - parentWinOffset.top - parseNumeric(parentComputedStyle.borderTopWidth),
			left: nodeWinOffset.left - parentWinOffset.left - parseNumeric(parentComputedStyle.borderLeftWidth),
			right: -nodeWinOffset.right + parentWinOffset.right - parseNumeric(parentComputedStyle.borderRightWidth)
		};
		this._styles = {
			position: originalPosition,
			top: node.style.top,
			bottom: node.style.bottom,
			left: node.style.left,
			right: node.style.right,
			width: node.style.width,
			marginTop: node.style.marginTop,
			marginLeft: node.style.marginLeft,
			marginRight: node.style.marginRight
		};

		const nodeTopValue = parseNumeric(nodeComputedProps.top);
		this._limits = {
			start: nodeWinOffset.top + window.pageYOffset - nodeTopValue,
			end: parentWinOffset.top + window.pageYOffset + parentNode.offsetHeight -
				parseNumeric(parentComputedStyle.borderBottomWidth) - node.offsetHeight -
				nodeTopValue - parseNumeric(nodeComputedProps.marginBottom)
		};

		/*
         * 确保将节点相对于父节点放置
         */
		const parentPosition = parentComputedStyle.position

		if (
			parentPosition != 'absolute' &&
			parentPosition != 'relative'
		) {
			parentNode.style.position = 'relative'
		}

		/*
         * 重新计算节点位置
         * 请务必在克隆注入之前执行此操作，以免在Chrome浏览器中滚动错误
         */
		this._recalcPosition();

		/*
         * 创建一个克隆
         */
		const clone = this._clone = {}
		clone.node = document.createElement('div')

		// 把样式应用到克隆上
		extend(clone.node.style, {
			width: nodeWinOffset.right - nodeWinOffset.left + 'px',
			height: nodeWinOffset.bottom - nodeWinOffset.top + 'px',
			marginTop: nodeComputedProps.marginTop,
			marginBottom: nodeComputedProps.marginBottom,
			marginLeft: nodeComputedProps.marginLeft,
			marginRight: nodeComputedProps.marginRight,
			cssFloat: nodeComputedProps.cssFloat,
			padding: 0,
			border: 0,
			borderSpacing: 0,
			fontSize: '1em',
			position: 'static'
		});

		referenceNode.insertBefore(clone.node, node);
		clone.docOffsetTop = getDocOffsetTop(clone.node)
	}

	_recalcPosition () {
		if (!this._active || this._removed) return;

		const stickyMode = scroll.top <= this._limits.start? 'start': scroll.top >= this._limits.end? 'end': 'middle';

		if (this._stickyMode == stickyMode) return;

		switch (stickyMode) {
			case 'start':
				extend(this._node.style, {
					position: 'absolute',
					left: this._offsetToParent.left + 'px',
					right: this._offsetToParent.right + 'px',
					top: this._offsetToParent.top + 'px',
					bottom: 'auto',
					width: 'auto',
					marginLeft: 0,
					marginRight: 0,
					marginTop: 0
				});
				break;

			case 'middle':
				extend(this._node.style, {
					position: 'fixed',
					left: this._offsetToWindow.left + 'px',
					right: this._offsetToWindow.right + 'px',
					top: this._styles.top,
					bottom: 'auto',
					width: 'auto',
					marginLeft: 0,
					marginRight: 0,
					marginTop: 0
				});
				break;

			case 'end':
				extend(this._node.style, {
					position: 'absolute',
					left: this._offsetToParent.left + 'px',
					right: this._offsetToParent.right + 'px',
					top: 'auto',
					bottom: 0,
					width: 'auto',
					marginLeft: 0,
					marginRight: 0
				});
				break;
		}

		this._stickyMode = stickyMode;
	}

	_fastCheck () {
		if (!this._active || this._removed) return;

		if (
			Math.abs(getDocOffsetTop(this._clone.node) - this._clone.docOffsetTop) > 1 ||
			Math.abs(this._parent.node.offsetHeight - this._parent.offsetHeight) > 1
		) this.refresh();
	}

	_deactivate () {
		if (!this._active || this._removed) return;

		this._clone.node.parentNode.removeChild(this._clone.node);
		delete this._clone;

		extend(this._node.style, this._styles);
		delete this._styles;

		// 检查元素的父节点是否被其他sticky实例使用过
		// 如果不是，还原父节点的样式
		if (!stickies.some(sticky => sticky !== this && sticky._parent && sticky._parent.node === this._parent.node)) {
			extend(this._parent.node.style, this._parent.styles);
		}
		delete this._parent;

		this._stickyMode = null;
		this._active = false;

		delete this._offsetToWindow;
		delete this._offsetToParent;
		delete this._limits;
	}

	remove () {
		this._deactivate();

		stickies.some((sticky, index) => {
			if (sticky._node === this._node) {
				stickies.splice(index, 1);
				return true;
			}
		});

		this._removed = true;
	}
}


/*
 * 5. Stickyfill API
 */
const Stickyfill = {
	stickies,
	Sticky,

	forceSticky () {
		styFlag = false;
		init();

		this.refreshAll();
	},

	addOne (node) {
		// 检查是否是一个节点
		if (!(node instanceof HTMLElement)) {
			// Maybe it’s a node list of some sort?
			// Take first node from the list then
			if (node.length && node[0]) node = node[0];
			else return;
		}

		// 检查是否已将sticky应用于节点并且返回已存在的sticky
		for (var i = 0; i < stickies.length; i++) {
			if (stickies[i]._node === node) return stickies[i];
		}

		// 创建并且返回一个sticky
		return new Sticky(node);
	},

	add (nodeList) {
		// 如果是一个节点，则将一个节点组成一个数组
		if (nodeList instanceof HTMLElement) nodeList = [nodeList];
		// 检查参数是否为某种可迭代的属性
		if (!nodeList.length) return;

		// 将每个元素添加为sticky对象，并返回创建的sticky实例数组
		const addedStickies = [];

		for (let i = 0; i < nodeList.length; i++) {
			const node = nodeList[i];

			// 如果不是HTMLElement，请创建一个空元素以保留与输入列表的一对一关联
			if (!(node instanceof HTMLElement)) {
				addedStickies.push(void 0);
				continue;
			}

			// 如果sticky已应用于节点，请添加现有的sticky
			if (stickies.some(sticky => {
				if (sticky._node === node) {
					addedStickies.push(sticky);
					return true;
				}
			})) continue;

			// 创建并添加新的sticky
			addedStickies.push(new Sticky(node));
		}

		return addedStickies;
	},

	refreshAll () {
		stickies.forEach(sticky => sticky.refresh());
	},

	removeOne (node) {
		// 检查是否为节点
		if (!(node instanceof HTMLElement)) {
			// 也许是某种形式的节点列表
			// 从列表中选择第一个节点，然后
			if (node.length && node[0]) node = node[0];
			else return;
		}

		// 删除绑定到列表中的sticky
		stickies.some(sticky => {
			if (sticky._node === node) {
				sticky.remove();
				return true;
			}
		});
	},

	remove (nodeList) {
		// 如果是一个节点就创建一个节点数组
		if (nodeList instanceof HTMLElement) nodeList = [nodeList];
		// 检查是否可迭代
		if (!nodeList.length) return;

		// 删除绑定到列表中的节点的sticky
		for (let i = 0; i < nodeList.length; i++) {
			const node = nodeList[i];

			stickies.some(sticky => {
				if (sticky._node === node) {
					sticky.remove();
					return true;
				}
			});
		}
	},

	removeAll () {
		while (stickies.length) stickies[0].remove();
	}
};

/*
 * 6. 设置事件（除非禁用了polyfill）
 */
function init () {
	if (isInitialized) {
		return;
	}

	isInitialized = true;

	// 注意滚动位置的更改，并在需要时触发重新计算/刷新
	function checkScroll () {
		if (window.pageXOffset != scroll.left) {
			scroll.top = window.pageYOffset;
			scroll.left = window.pageXOffset;

			Stickyfill.refreshAll();
		}
		else if (window.pageYOffset != scroll.top) {
			scroll.top = window.pageYOffset;
			scroll.left = window.pageXOffset;

			// 重新计算所有sticky的位置
			stickies.forEach(sticky => sticky._recalcPosition());
		}
	}

	checkScroll();
	window.addEventListener('scroll', checkScroll);

	// 监视窗口大小调整和设备方向更改并触发刷新
	window.addEventListener('resize', Stickyfill.refreshAll);
	window.addEventListener('orientationchange', Stickyfill.refreshAll);

	// 每500ms进行快速脏检查以检查布局是否更改
	let fastCheckTimer;

	function startFastCheckTimer () {
		fastCheckTimer = setInterval(function () {
			stickies.forEach(sticky => sticky._fastCheck());
		}, 500);
	}

	function stopFastCheckTimer () {
		clearInterval(fastCheckTimer);
	}

	let docHiddenKey;
	let visibilityChangeEventName;

	if ('hidden' in document) {
		docHiddenKey = 'hidden';
		visibilityChangeEventName = 'visibilitychange';
	}
	else if ('webkitHidden' in document) {
		docHiddenKey = 'webkitHidden';
		visibilityChangeEventName = 'webkitvisibilitychange';
	}

	if (visibilityChangeEventName) {
		if (!document[docHiddenKey]) startFastCheckTimer();

		document.addEventListener(visibilityChangeEventName, () => {
			if (document[docHiddenKey]) {
				stopFastCheckTimer();
			}
			else {
				startFastCheckTimer();
			}
		});
	}
	else startFastCheckTimer();
}

if (!styFlag) init();


/*
 * 7. 导出sticky
 */
if (typeof module != 'undefined' && module.exports) {
	module.exports = Stickyfill;
}
else if (isWindowDefined) {
	window.Stickyfill = Stickyfill;
}
