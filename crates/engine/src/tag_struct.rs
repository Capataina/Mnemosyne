use serde::{Deserialize, Serialize};

use crate::db::ID;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub id: ID,
    pub name: String,
    pub color: String,
}

impl Tag {
    pub fn new(id: ID, name: String, color: String) -> Self {
        Self { id, name, color }
    }
}

/// A tag paired with the number of VISIBLE images carrying it — the
/// library drawer renders each tag-folder with this count.
///
/// A separate type from `Tag` (rather than a `count` field on `Tag`)
/// because the tags embedded in an image row have no meaningful global
/// count; the count only makes sense in the catalogue-level
/// `get_tag_counts` view. Serialises to `{ "tag_id": N, "count": M }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagCount {
    pub tag_id: ID,
    pub count: i64,
}
