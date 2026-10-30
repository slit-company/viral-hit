import { m as uiMessages } from '@/paraglide/messages.js';
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
    get title() { return uiMessages["studio.tools.create_image"](); },
    get description() { return uiMessages["studio.tools.turn_the_scene_in_your_mind_into_an_image"](); },
    get hint() { return uiMessages["studio.tools.describe_the_scene_including_people_background_lighting_and_mood"](); },
  },
  'image-edit': {
    get title() { return uiMessages["studio.tools.edit_image"](); },
    get description() { return uiMessages["studio.tools.keep_what_works_and_change_what_you_need"](); },
    get hint() { return uiMessages["studio.tools.describe_what_to_change_and_what_to_keep"](); },
  },
  'remove-background': {
    get title() { return uiMessages["studio.tools.remove_background"](); },
    get description() { return uiMessages["studio.tools.keep_the_subject_and_place_it_in_a_new_scene"](); },
    get hint() { return uiMessages["studio.tools.add_an_image_to_remove_its_background"](); },
  },
  'image-upscale': {
    get title() { return uiMessages["studio.tools.upscale_image"](); },
    get description() { return uiMessages["studio.tools.bring_out_more_detail_in_a_small_image"](); },
    get hint() { return uiMessages["studio.tools.add_the_image_you_want_to_upscale"](); },
  },
  'video-generate': {
    get title() { return uiMessages["studio.tools.create_video"](); },
    get description() { return uiMessages["studio.tools.start_with_a_description_or_an_image"](); },
    get hint() { return uiMessages["studio.tools.describe_the_camera_movement_action_and_mood"](); },
  },
  'video-edit': {
    get title() { return uiMessages["studio.tools.edit_video"](); },
    get description() { return uiMessages["studio.tools.take_your_existing_video_in_a_new_direction"](); },
    get hint() { return uiMessages["studio.tools.describe_what_to_change_in_the_source_video"](); },
  },
  'motion-control': {
    get title() { return uiMessages["studio.tools.motion_control"](); },
    get description() { return uiMessages["studio.tools.apply_motion_from_a_reference_video_to_a_new_subject"](); },
    get hint() { return uiMessages["studio.tools.who_should_follow_which_movements"](); },
  },
  'motion-transfer': {
    get title() { return uiMessages["studio.tools.transfer_motion"](); },
    get description() { return uiMessages["studio.tools.make_the_person_in_a_photo_move_like_your_reference"](); },
    get hint() { return uiMessages["studio.tools.add_a_character_image_and_a_motion_reference_video"](); },
  },
  'object-swap': {
    get title() { return uiMessages["studio.tools.swap_subject"](); },
    get description() { return uiMessages["studio.tools.change_a_person_or_object_while_keeping_the_scene"](); },
    get hint() { return uiMessages["studio.tools.which_subject_should_change_and_what_should_replace_it"](); },
  },
  restyle: {
    get title() { return uiMessages["studio.tools.restyle_video"](); },
    get description() { return uiMessages["studio.tools.give_the_same_scene_a_new_texture_and_mood"](); },
    get hint() { return uiMessages["studio.tools.add_a_video_and_choose_your_preferred_style"](); },
  },
  'image-lipsync': {
    get title() { return uiMessages["studio.tools.animate_a_portrait"](); },
    get description() { return uiMessages["studio.tools.give_a_portrait_a_voice"](); },
    get hint() { return uiMessages["studio.tools.add_a_face_image_and_an_audio_recording_of_the_dialogue"](); },
  },
  'video-lipsync': {
    get title() { return uiMessages["studio.tools.lip_sync_video"](); },
    get description() { return uiMessages["studio.tools.match_lip_movements_to_new_dialogue"](); },
    get hint() { return uiMessages["studio.tools.add_a_character_video_and_the_audio_to_use"](); },
  },
  'text-to-speech': {
    get title() { return uiMessages["studio.tools.text_to_speech"](); },
    get description() { return uiMessages["studio.tools.write_your_dialogue_and_choose_a_voice"](); },
    get hint() { return uiMessages["studio.tools.enter_the_exact_words_to_read_aloud"](); },
  },
  'voice-change': {
    get title() { return uiMessages["studio.tools.change_voice"](); },
    get description() { return uiMessages["studio.tools.give_the_original_delivery_a_different_voice"](); },
    get hint() { return uiMessages["studio.tools.add_the_source_audio_and_choose_a_voice"](); },
  },
  'audio-generate': {
    get title() { return uiMessages["studio.tools.create_audio"](); },
    get description() { return uiMessages["studio.tools.generate_or_transform_sound"](); },
    get hint() { return uiMessages["studio.tools.what_sound_would_you_like_to_create_or_change"](); },
  },
  'music-generate': {
    get title() { return uiMessages["studio.tools.create_music"](); },
    get description() { return uiMessages["studio.tools.make_a_soundtrack_that_fits_your_scene"](); },
    get hint() { return uiMessages["studio.tools.describe_the_genre_instruments_tempo_and_mood_you_can_include_lyrics"](); },
  },
  'video-caption': {
    get title() { return uiMessages["studio.tools.add_captions"](); },
    get description() { return uiMessages["studio.tools.make_every_spoken_word_easy_to_follow"](); },
    get hint() { return uiMessages["studio.tools.add_a_video_and_choose_the_caption_language_and_style"](); },
  },
  'video-dubbing': {
    get title() { return uiMessages["studio.tools.dub_into_another_language"](); },
    get description() { return uiMessages["studio.tools.tell_the_same_story_in_another_language"](); },
    get hint() { return uiMessages["studio.tools.add_the_source_video_and_choose_the_target_language"](); },
  },
  'video-upscale': {
    get title() { return uiMessages["studio.tools.upscale_video"](); },
    get description() { return uiMessages["studio.tools.refine_the_details_of_your_finished_video"](); },
    get hint() { return uiMessages["studio.tools.add_the_video_you_want_to_enhance"](); },
  },
  'media-analysis': {
    get title() { return uiMessages["studio.tools.analyze_references"](); },
    get description() { return uiMessages["studio.tools.find_ideas_in_scenes_structure_and_sound"](); },
    get hint() { return uiMessages["studio.tools.what_would_you_like_to_learn_from_your_references"](); },
  },
};
export const toolGroups = [
  {
    id: 'image',
    get label() { return uiMessages["studio.tools.image"](); },
    icon: Image,
    tools: ['image-generate', 'image-edit', 'remove-background'],
  },
  {
    id: 'video',
    get label() { return uiMessages["studio.tools.video"](); },
    icon: Film,
    tools: ['video-generate', 'video-edit', 'motion-control'],
  },
  {
    id: 'remix',
    get label() { return uiMessages["studio.tools.remix"](); },
    icon: WandSparkles,
    tools: ['motion-transfer', 'object-swap', 'restyle'],
  },
  {
    id: 'lipsync',
    get label() { return uiMessages["studio.tools.lip_sync"](); },
    icon: AudioLines,
    tools: ['image-lipsync', 'video-lipsync'],
  },
  {
    id: 'voice',
    get label() { return uiMessages["studio.tools.voice"](); },
    icon: Mic,
    tools: ['text-to-speech', 'voice-change', 'audio-generate'],
  },
  { id: 'music', get label() { return uiMessages["studio.tools.music"](); }, icon: Music2, tools: ['music-generate'] },
  {
    id: 'caption',
    get label() { return uiMessages["studio.tools.captions_dubbing"](); },
    icon: Captions,
    tools: ['video-caption', 'video-dubbing'],
  },
  {
    id: 'enhance',
    get label() { return uiMessages["studio.tools.enhance"](); },
    icon: Expand,
    tools: ['video-upscale', 'image-upscale'],
  },
  {
    id: 'analysis',
    get label() { return uiMessages["studio.tools.analysis"](); },
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
