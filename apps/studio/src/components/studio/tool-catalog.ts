import {
  Image,
  Film,
  WandSparkles,
  Mic,
  Music2,
  Captions,
  ScanSearch,
  Expand,
  AudioLines,
} from 'lucide-react';
import type { StudioToolId } from '@/core/studio/tools';
export const toolCopy: Record<
  StudioToolId,
  { title: string; description: string; hint: string }
> = {
  'image-generate': {
    title: '이미지 만들기',
    description: '머릿속 장면을 한 장의 이미지로.',
    hint: '어떤 장면을 만들까요? 인물, 배경, 조명과 분위기를 적어주세요.',
  },
  'image-edit': {
    title: '이미지 수정',
    description: '원본의 좋은 점은 살리고, 필요한 부분만 바꿔보세요.',
    hint: '바꾸고 싶은 부분과 그대로 둘 부분을 설명해주세요.',
  },
  'remove-background': {
    title: '배경 지우기',
    description: '피사체만 남겨 새로운 장면에 활용하세요.',
    hint: '배경을 지울 이미지를 추가하세요.',
  },
  'image-upscale': {
    title: '이미지 화질 개선',
    description: '작은 이미지의 디테일을 더 선명하게.',
    hint: '화질을 높일 원본을 추가하세요.',
  },
  'video-generate': {
    title: '영상 만들기',
    description: '한 줄의 설명, 한 장의 이미지에서 시작하세요.',
    hint: '카메라는 어떻게 움직이나요? 장면의 움직임과 분위기를 적어주세요.',
  },
  'video-edit': {
    title: '영상 수정',
    description: '기존 영상에서 다음 장면을 만들어보세요.',
    hint: '원본 영상에서 무엇을 바꿀지 설명해주세요.',
  },
  'motion-control': {
    title: '움직임 따라 만들기',
    description: '참고 영상의 움직임을 새 피사체에 적용하세요.',
    hint: '누가, 어떤 움직임을 따라 하나요?',
  },
  'motion-transfer': {
    title: '동작 옮기기',
    description: '사진 속 인물이 참고 영상처럼 움직여요.',
    hint: '인물 사진과 움직임을 참고할 영상을 추가하세요.',
  },
  'object-swap': {
    title: '피사체 바꾸기',
    description: '장면은 이어가고, 인물이나 사물을 바꾸세요.',
    hint: '영상 속 어떤 피사체를 무엇으로 바꿀까요?',
  },
  restyle: {
    title: '스타일 바꾸기',
    description: '같은 장면을 전혀 다른 질감과 분위기로.',
    hint: '영상과 원하는 스타일을 골라주세요.',
  },
  'image-lipsync': {
    title: '사진으로 말하기',
    description: '인물 사진에 목소리를 입혀보세요.',
    hint: '얼굴 사진과 대사를 담은 오디오를 추가하세요.',
  },
  'video-lipsync': {
    title: '영상 입 모양 맞추기',
    description: '새로운 대사에 영상 속 입 모양을 맞춰요.',
    hint: '인물 영상과 사용할 오디오를 추가하세요.',
  },
  'text-to-speech': {
    title: '글을 목소리로',
    description: '대사를 쓰고, 어울리는 목소리를 골라보세요.',
    hint: '읽어줄 대사를 그대로 적어주세요.',
  },
  'voice-change': {
    title: '목소리 바꾸기',
    description: '원본의 말투에 새로운 목소리를 더해요.',
    hint: '원본 오디오와 사용할 목소리를 골라주세요.',
  },
  'audio-generate': {
    title: '오디오 만들기',
    description: '소리 생성부터 오디오 가공까지.',
    hint: '어떤 소리를 만들거나 바꾸고 싶나요?',
  },
  'music-generate': {
    title: '음악 만들기',
    description: '장면의 분위기에 꼭 맞는 사운드트랙.',
    hint: '장르, 악기, 빠르기, 분위기를 적어주세요. 가사도 넣을 수 있어요.',
  },
  'video-caption': {
    title: '자막 입히기',
    description: '영상 속 말이 눈에 잘 들어오도록.',
    hint: '자막을 넣을 영상을 추가하고 언어와 스타일을 골라주세요.',
  },
  'video-dubbing': {
    title: '다른 언어로 더빙',
    description: '같은 이야기를 다른 언어로 전하세요.',
    hint: '원본 영상과 번역할 언어를 골라주세요.',
  },
  'video-upscale': {
    title: '영상 화질 개선',
    description: '완성한 영상의 디테일을 한 번 더 다듬어요.',
    hint: '화질을 개선할 영상을 추가하세요.',
  },
  'media-analysis': {
    title: '레퍼런스 분석',
    description: '장면, 구성, 소리에서 다음 아이디어를 찾으세요.',
    hint: '참고 자료에서 무엇을 살펴볼까요?',
  },
};
export const toolGroups = [
  {
    id: 'image',
    label: '이미지',
    icon: Image,
    tools: ['image-generate', 'image-edit', 'remove-background'],
  },
  {
    id: 'video',
    label: '영상',
    icon: Film,
    tools: ['video-generate', 'video-edit', 'motion-control'],
  },
  {
    id: 'remix',
    label: '리믹스',
    icon: WandSparkles,
    tools: ['motion-transfer', 'object-swap', 'restyle'],
  },
  {
    id: 'lipsync',
    label: '립싱크',
    icon: AudioLines,
    tools: ['image-lipsync', 'video-lipsync'],
  },
  {
    id: 'voice',
    label: '음성',
    icon: Mic,
    tools: ['text-to-speech', 'voice-change', 'audio-generate'],
  },
  { id: 'music', label: '음악', icon: Music2, tools: ['music-generate'] },
  {
    id: 'caption',
    label: '자막·더빙',
    icon: Captions,
    tools: ['video-caption', 'video-dubbing'],
  },
  {
    id: 'enhance',
    label: '화질 개선',
    icon: Expand,
    tools: ['video-upscale', 'image-upscale'],
  },
  {
    id: 'analysis',
    label: '분석',
    icon: ScanSearch,
    tools: ['media-analysis'],
  },
] satisfies {
  id: string;
  label: string;
  icon: typeof Image;
  tools: StudioToolId[];
}[];
export const groupForTool = (tool: StudioToolId) =>
  toolGroups.find((group) => (group.tools as StudioToolId[]).includes(tool))!;
