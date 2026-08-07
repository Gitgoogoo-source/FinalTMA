import collectionSkills from "./collection-skills-v1.json";

export type CollectionSkill = {
  name: string;
  damage: number;
};

type CollectionSkillEntry = {
  template_id: string;
  skills: readonly CollectionSkill[];
};

const skillsByTemplateId = new Map(
  (collectionSkills as readonly CollectionSkillEntry[]).map((entry) => [
    entry.template_id,
    entry.skills,
  ]),
);

export function getCollectionSkills(
  templateId: string,
): readonly CollectionSkill[] {
  return skillsByTemplateId.get(templateId) ?? [];
}
