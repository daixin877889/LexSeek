import { h } from 'vue';

/**
 * 法槌图标组件
 * 用于网站首页的案由确认功能展示
 * @param {Object} props - 组件属性
 * @returns {VNode} 渲染的图标
 */
export const GavelIcon = (props) => {
    return h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: props.size || props.width || 24,
        height: props.size || props.height || 24,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: props.color || 'currentColor',
        'stroke-width': props['stroke-width'] || 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        class: props.class,
        ...props,
    }, [
        h('path', {
            d: 'M14 13L3.5 2.5C2.83 1.83 1.17 1.83 0.5 2.5C-0.17 3.17 -0.17 4.83 0.5 5.5L11 16',
        }),
        h('path', {
            d: 'M14 16L18 20',
        }),
        h('path', {
            d: 'M15 9L20 4L22 6L17 11',
        }),
        h('path', {
            d: 'M9 15H4V20H9V15Z',
        }),
    ]);
};

export default GavelIcon; 