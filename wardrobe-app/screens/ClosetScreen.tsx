import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { ItemTile } from '../components/ItemTile';
import { useDbQuery } from '../hooks/useDbQuery';
import { listItems } from '../services/items';
import { ALL_CATEGORIES } from '../utils/categories';
import type { RootStackParamList } from '../navigation/types';
import type { Category } from '../types/wardrobe';

const COLUMNS = 3;

export function ClosetScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // null is the "All" chip rather than a missing value; listItems reads it the
  // same way.
  const [filter, setFilter] = useState<Category | null>(null);

  const { data: items, error, loading } = useDbQuery((db) => listItems(db, filter), [filter]);

  return (
    <View className="flex-1 bg-slate-50">
      <View className="border-b border-slate-200 bg-white">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-3 py-3"
        >
          <Chip label="All" selected={filter === null} onPress={() => setFilter(null)} />
          {ALL_CATEGORIES.map((category) => (
            <Chip
              key={category}
              label={category}
              selected={filter === category}
              onPress={() => setFilter(category)}
            />
          ))}
        </ScrollView>
      </View>

      {error ? (
        <EmptyState title={error} />
      ) : loading && items === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          contentContainerClassName="p-2 pb-28 grow"
          ListEmptyComponent={
            <EmptyState
              title="No items yet"
              detail={
                filter
                  ? `Nothing in ${filter}. Tap + to add something.`
                  : 'Tap + to add your first item.'
              }
            />
          }
          renderItem={({ item }) => (
            <ItemTile
              item={item}
              onPress={() => navigation.navigate('ItemDetails', { itemId: item.id })}
            />
          )}
        />
      )}

      <Pressable
        onPress={() => navigation.navigate('AddItem', filter ? { category: filter } : undefined)}
        accessibilityRole="button"
        accessibilityLabel="Add item"
        className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-slate-900 items-center justify-center shadow-lg"
      >
        <Text className="text-white text-3xl leading-9">+</Text>
      </Pressable>
    </View>
  );
}
